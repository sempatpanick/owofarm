import { allocateEssence } from './hbCalc';
import { solveHbCaptcha } from './huntBotSolver';
import type {
  CommandPayload,
  HuntbotBotContext,
  HuntbotMessage,
  HuntbotTrait,
  MessageEmbed,
  UpgradeDetails,
} from './types';
import { HUNTBOT_TRAITS } from './types';

const PASSWORD_RESET_REGEX = /(?<=Password will reset in )(\d+)/;
const HUNTBOT_TIME_REGEX = /(\d+)([DHM])/g;
const LEVEL_PROGRESS_REGEX = /Lvl (\d+) \[(\d+)\/\d+\]/;
const ESSENCE_REGEX = /Animal Essence - `(\d{1,3}(?:,\d{3})*)`/;

function createTraitState(): UpgradeDetails[HuntbotTrait] {
  return { enabled: false, current_level: 0, invested: 0 };
}

function createUpgradeDetails(): UpgradeDetails {
  return {
    essence: 0,
    efficiency: createTraitState(),
    duration: createTraitState(),
    cost: createTraitState(),
    gain: createTraitState(),
    exp: createTraitState(),
    radar: createTraitState(),
  };
}

export function fetchLevelAndProgress(value: string): { level: number; invested: number } {
  if (value.includes('[MAX]')) {
    return { level: 1000, invested: 0 };
  }

  const match = value.match(LEVEL_PROGRESS_REGEX);
  if (!match) {
    throw new Error(`Could not parse HuntBot level progress: ${value}`);
  }

  return {
    level: Number(match[1]),
    invested: Number(match[2]),
  };
}

export function fetchEssence(name: string): number {
  const match = name.match(ESSENCE_REGEX);
  if (!match) {
    throw new Error(`Could not parse HuntBot essence: ${name}`);
  }

  return Number(match[1].replace(/,/g, ''));
}

export function parseHuntbotDuration(text: string): number {
  let totalSeconds = 0;

  for (const match of text.matchAll(HUNTBOT_TIME_REGEX)) {
    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === 'M') {
      totalSeconds += amount * 60;
    } else if (unit === 'H') {
      totalSeconds += amount * 3600;
    } else if (unit === 'D') {
      totalSeconds += amount * 86400;
    }
  }

  return totalSeconds;
}

function getUpgraderCooldown(sleeptime: [number, number] | number | null): number {
  if (sleeptime === null) {
    return 0;
  }

  if (Array.isArray(sleeptime)) {
    const [min, max] = sleeptime;
    return min + Math.random() * (max - min);
  }

  return sleeptime;
}

export class HuntbotHandler {
  private readonly upgradeResolvers = new Set<() => void>();

  readonly cmd: CommandPayload;
  readonly upgradeCmd: CommandPayload;
  readonly upgradeDetails: UpgradeDetails;

  constructor(private readonly bot: HuntbotBotContext) {
    this.cmd = {
      cmd_name: bot.alias.huntbot.normal,
      cmd_arguments: '',
      prefix: true,
      checks: true,
      id: 'huntbot',
    };

    this.upgradeCmd = {
      cmd_name: bot.alias.upgrade.normal,
      cmd_arguments: '',
      prefix: true,
      checks: true,
      id: 'upgrade',
    };

    this.upgradeDetails = createUpgradeDetails();

    for (const trait of this.getEnabledTraits()) {
      this.upgradeDetails[trait].enabled = true;
    }
  }

  get settings() {
    return this.bot.settings.huntbot;
  }

  get cooldowns() {
    return this.bot.settings.cooldowns;
  }

  getEnabledTraits(): HuntbotTrait[] {
    return HUNTBOT_TRAITS.filter((trait) => this.settings.upgrader.traits[trait]);
  }

  async onLoad(): Promise<void> {
    if (!this.settings.enabled) {
      return;
    }

    await this.sendAh({ startup: true });
  }

  async onUnload(): Promise<void> {
    await this.bot.removeQueue({ id: 'huntbot' });
  }

  async sendAh(
    options: {
      startup?: boolean;
      noCashArg?: boolean;
      timeToSleep?: number | [number, number];
      ans?: string;
    } = {}
  ): Promise<void> {
    const { startup = false, noCashArg = true, timeToSleep, ans } = options;

    if (startup) {
      await this.bot.sleepTill(this.cooldowns.briefCooldown);
    } else {
      await this.bot.removeQueue({ id: 'huntbot' });

      if (Array.isArray(timeToSleep)) {
        await this.bot.sleepTill(timeToSleep);
      } else if (timeToSleep !== undefined) {
        await this.bot.sleepTill(timeToSleep, { cdList: false, noise: 30 });
      }
    }

    if (noCashArg) {
      this.cmd.cmd_arguments = '';
    } else {
      this.cmd.cmd_arguments = String(this.settings.cashToSpend);
    }

    if (ans) {
      this.cmd.cmd_arguments = `${this.settings.cashToSpend} ${ans}`;
    }

    await this.bot.putQueue(this.cmd);
  }

  private waitForUpgradeConfirmation(timeoutMs = 240_000): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        this.upgradeResolvers.delete(finish);
        resolve();
      };

      const timeout = setTimeout(finish, timeoutMs);
      this.upgradeResolvers.add(finish);
    });
  }

  private notifyUpgradeConfirmed(): void {
    for (const resolve of this.upgradeResolvers) {
      resolve();
    }
    this.upgradeResolvers.clear();
  }

  private async upgradeConfirmation(): Promise<void> {
    await this.waitForUpgradeConfirmation();
    await this.bot.sleepTill(this.cooldowns.briefCooldown);
  }

  private getExperience(embed: MessageEmbed): void {
    for (const field of embed.fields ?? []) {
      for (const trait of HUNTBOT_TRAITS) {
        if (field.name.toLowerCase().includes(trait)) {
          const { level, invested } = fetchLevelAndProgress(field.value);
          this.upgradeDetails[trait].current_level = level;
          this.upgradeDetails[trait].invested = invested;
          break;
        }
      }

      if (field.name.toLowerCase().includes('animal essence')) {
        this.upgradeDetails.essence = fetchEssence(field.name);
      }
    }
  }

  async onMessage(message: HuntbotMessage): Promise<void> {
    if (message.channelId !== this.bot.cmChannelId) {
      return;
    }

    if (message.authorId !== this.bot.owoBotId) {
      return;
    }

    const nick = this.bot.getNick(message);

    if (message.content.includes(nick)) {
      if (message.content.includes('You successfully upgraded')) {
        this.notifyUpgradeConfirmed();
        await this.bot.removeQueue({ id: 'upgrade' });
      } else if (message.content.includes('Here is your password!')) {
        const attachment = message.attachments?.[0];
        if (!attachment) {
          return;
        }

        const ans = await solveHbCaptcha(attachment.url, this.bot.session);
        await this.bot.log('huntbot received password, attempting to solve!', '#afaf87');
        await this.sendAh({
          timeToSleep: this.cooldowns.briefCooldown,
          ans,
        });
      } else if (message.content.includes('Please include your password!')) {
        const resetMatch = message.content.match(PASSWORD_RESET_REGEX);
        const totalSecondsHb = resetMatch ? Number(resetMatch[1]) * 60 : this.cooldowns.briefCooldown;

        await this.bot.log(`huntbot stuck in password, retrying in ${totalSecondsHb}s`, '#afaf87');
        await this.sendAh({ timeToSleep: totalSecondsHb });
      } else if (message.content.includes('I WILL BE BACK IN')) {
        const totalSecondsHb = parseHuntbotDuration(message.content);
        await this.bot.log(`huntbot will be back in ${totalSecondsHb}s`, '#afaf87');
        await this.sendAh({ timeToSleep: totalSecondsHb });
      }
    }

    for (const embed of message.embeds ?? []) {
      if (!embed.author?.name?.includes(`${nick}'s HuntBot`)) {
        continue;
      }

      await this.bot.removeQueue({ id: 'huntbot' });

      if (!embed.fields?.length) {
        continue;
      }

      this.getExperience(embed);

      const allocation = allocateEssence(this.upgradeDetails, this.settings.upgrader.weights);

      await this.bot.sleep(getUpgraderCooldown(this.settings.upgrader.sleeptime));

      for (const [trait, essenceAlloc] of Object.entries(allocation)) {
        this.upgradeCmd.cmd_arguments = `${trait} ${essenceAlloc}`;

        if (essenceAlloc > 0) {
          await this.bot.putQueue(this.upgradeCmd, { priority: true });
          await this.upgradeConfirmation();
        }
      }

      if (embed.fields.length > 8) {
        const field = embed.fields[8];

        if (field.name.includes('HUNTBOT is currently hunting!')) {
          const totalSecondsHb = parseHuntbotDuration(field.value);
          await this.bot.log(`huntbot will be back in ${totalSecondsHb}s`, '#afaf87');
          await this.sendAh({ timeToSleep: totalSecondsHb });
          continue;
        }
      }

      await this.sendAh({
        timeToSleep: this.cooldowns.briefCooldown,
        noCashArg: false,
      });
      await this.bot.log('huntbot back! sending next huntbot command.', '#afaf87');
    }
  }
}
