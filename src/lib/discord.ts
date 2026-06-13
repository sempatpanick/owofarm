import { Client, Message, TextChannel, Options } from 'discord.js-selfbot-v13';
import notifier from 'node-notifier';
import Logger from '../tools/logger';
import config from '../config/config';
import { superscriptToNumber } from '../tools/format';
import { Items, Gems } from '../enums/items';
import checkAndWatchConfig from '../tools/autoConfig';
import { getOwoCaptchaUrl, solveOwoCaptcha } from '../tools/loginOwo';
import { openIsolatedUrl } from '../tools/browser';
import { acquireBrowserSlot, isBrowserQueueEnabled, releaseBrowserSlot } from '../tools/browserQueue';
import { HuntbotIntegration } from './huntbotIntegration';
import type { HuntbotSettings } from '../huntbot';

class AutoFarm {
  private token: string = '';
  private logger: Logger;
  private client: Client;
  private setting: typeof config = config;
  private botStatus: boolean = true;
  private botReady: boolean = false;
  private timeoutId = {
    hunt: 0 as unknown as NodeJS.Timeout,
    battle: 0 as unknown as NodeJS.Timeout,
    zoo: 0 as unknown as NodeJS.Timeout,
    pray: 0 as unknown as NodeJS.Timeout,
    curse: 0 as unknown as NodeJS.Timeout,
    inventory: 0 as unknown as NodeJS.Timeout,
    checklist: 0 as unknown as NodeJS.Timeout,
    quest: 0 as unknown as NodeJS.Timeout,
  };
  private inventory = {} as any;
  private checkList = {
    daily: false,
    vote: false,
    cookie: false,
    quest: false,
    lootbox: false,
    crate: false,
  };
  private total = {
    hunt_exp: 0,
    hunt: 0,
  };
  private queue: { channel: string; message: string }[] = [];
  private intervalQueueId: NodeJS.Timeout | null = null;
  private quest: { [key: string]: { status: boolean; progress: { current: number; total: number } } } = {};
  private captchaSolving = false;
  private captchaTimers: NodeJS.Timeout[] = [];
  private farmPausedForHuntbot = false;
  private huntbotInitialized = false;
  private huntbot: HuntbotIntegration;
  private static readonly CAPTCHA_DEADLINE_MS = 10 * 60 * 1000;

  constructor(token: string) {
    this.token = token;
    this.client = new Client({
      sweepers: {
        ...Options.defaultSweeperSettings,
        /* messages: {
          interval: 10,
          lifetime: 15
        } */
      },
    });
    this.logger = new Logger();
    this.huntbot = new HuntbotIntegration({
      token: this.token,
      huntChannelId: config.channels.hunt,
      owoBotId: config.owoId,
      getHuntbotSettings: () => this.getHuntbotSettings(),
      getNickname: () => this.getNickname(),
      randomPrefix: (commands) => this.randomPrefix(commands),
      sendHuntbotMessage: (channelId, message) => this.sendMessage(channelId, message, true),
      pauseFarmForHuntbot: () => this.pauseFarmForHuntbot(),
      resumeFarmFromHuntbot: () => this.resumeFarmFromHuntbot(),
      logger: this.logger,
    });
    this.start();
  }

  start(): void {
    console.log('Starting AutoFarm');

    this.client.on('ready', async () => {
      this.logger.setID(this.client.user?.username as string);
      checkAndWatchConfig((this.client.user?.username as string) || 'default', (config) => {
        if (config) {
          this.setting = config;
          this.huntbot = new HuntbotIntegration({
            token: this.token,
            huntChannelId: this.setting.channels.hunt,
            owoBotId: this.setting.owoId,
            getHuntbotSettings: () => this.getHuntbotSettings(),
            getNickname: () => this.getNickname(),
            randomPrefix: (commands) => this.randomPrefix(commands),
            sendHuntbotMessage: (channelId, message) => this.sendMessage(channelId, message, true),
            pauseFarmForHuntbot: () => this.pauseFarmForHuntbot(),
            resumeFarmFromHuntbot: () => this.resumeFarmFromHuntbot(),
            logger: this.logger,
          });
          this.logger.info('Config loaded');
        }
      });
      this.logger.info(`Channels — hunt: ${this.setting.channels.hunt}, quest: ${this.setting.channels.quest}`);

      this.sendMessage(this.setting.channels.hunt, 'sempatpanick v1.0.0');
      this.autoChecklist();

      setTimeout(() => {
        if (!this.botReady) {
          this.botReady = true;
          this.startAutoFarm();
        }
      }, 8000);
    });

    this.client
      .login(this.token)
      .then(() => {
        this.logger.info('Logged in');
      })
      .catch((err) => {
        if (err.code === 'TOKEN_INVALID') {
          this.logger.danger('Invalid token');
        } else if (err.code === 'INVALID_INTENTS') {
          this.logger.danger(
            'Bot token detected. OwoFarm requires a Discord USER account token in .env, not a bot token from the Developer Portal.'
          );
        } else {
          this.logger.danger(`${err.code}: ${err.message}`);
        }
      });

    this.client.on('messageCreate', async (message) => {
      if (message.author.id !== this.setting.owoId) return;

      const nicknameOrDisplayName = message.guild?.members.me?.nickname || this.client.user?.displayName;
      const isMentioned =
        message.mentions.users.has(this.client.user?.id || '') || message.content.includes(this.client.user?.id || '');

      if (!this.isOwoResponseForMe(message, isMentioned, nicknameOrDisplayName)) return;

      const owoMessageText =
        message.cleanContent?.trim() ||
        message.embeds
          .map((embed) => embed.footer?.text?.trim())
          .filter((text): text is string => Boolean(text))
          .join(' | ');

      const isMessageEmbed = message.embeds.length > 0;
      const isMessageEmbedDescription = message.embeds[0]?.description;
      const isMessageEmbedAuthor = message.embeds[0]?.author?.name;

      const normalizedContent = message.content.replace(/[\u200B-\u200D\uFEFF]/g, '');

      // OwO Verification Handler (before captcha — success message also contains "human")
      const isVerificationSuccess =
        /verified that you are human/i.test(normalizedContent) || /Thank you! :3|👍/i.test(normalizedContent);
      if (isVerificationSuccess) return this.handleOwoSuccessVerification(message.content);

      // OwO Captcha Handler
      const isCaptchaVerification = /please complete your captcha to verify that you are human/i.test(
        normalizedContent
      );
      const captchaPattern = /(human|captcha|dm|banned|https:\/\/owobot.com\/captcha)/gi;
      const isCaptcha = isCaptchaVerification || (captchaPattern.test(normalizedContent) && isMentioned);

      if (isCaptcha) {
        this.logger.danger(`OwO message: ${owoMessageText}`);
        return this.handleOwoCaptcha();
      }

      this.logger.info(`OwO message: ${owoMessageText}`);

      // CheckList Handler
      const checklistPattern = new RegExp(`${nicknameOrDisplayName}'s Checklist`, 'g');
      if (
        isMessageEmbed &&
        isMessageEmbedDescription &&
        isMessageEmbedAuthor &&
        message.embeds[0]?.author?.name?.match(checklistPattern)
      )
        this.handleCheckList(message.embeds[0].description as string);

      // Check Hunt Gems
      const huntGemsPattern = new RegExp(`${nicknameOrDisplayName}\\*\\*( spent|, hunt)`, 'g');
      if (message.content?.match(huntGemsPattern)) this.handleHuntGems(message.content);

      // Inventory Handler
      const inventoryPattern = new RegExp(`${nicknameOrDisplayName}'s Inventory`, 'g');
      if (message.content?.match(inventoryPattern)) this.handleInventory(message.content);

      // Quest Handler
      const questLogPattern = new RegExp(`${nicknameOrDisplayName}'s Quest Log`, 'g');
      if (
        this.setting.status.quest &&
        isMessageEmbedDescription &&
        message.embeds[0]?.author?.name?.match(questLogPattern)
      )
        this.handleQuest(message.embeds[0].description as string);

      void this.huntbot.handleMessage({
        channelId: message.channel.id,
        authorId: message.author.id,
        content: message.content,
        embeds: message.embeds.map((embed) => ({
          author: embed.author ? { name: embed.author.name ?? undefined } : undefined,
          fields: embed.fields?.map((field) => ({
            name: field.name,
            value: field.value,
          })),
        })),
        attachments: [...message.attachments.values()].map((attachment) => ({
          url: attachment.url,
        })),
      });
    });
  }

  private getHuntbotSettings(): HuntbotSettings {
    return this.setting.huntbot ?? config.huntbot;
  }

  private getNickname(): string {
    return (
      this.client.guilds.cache.map((guild) => guild.members.me?.nickname).find((nickname) => Boolean(nickname)) ||
      this.client.user?.displayName ||
      this.client.user?.username ||
      ''
    );
  }

  private pauseFarmForHuntbot(): void {
    this.farmPausedForHuntbot = true;
    this.stopAutoFarm();
  }

  private resumeFarmFromHuntbot(): void {
    if (!this.farmPausedForHuntbot || !this.botStatus) {
      return;
    }

    this.farmPausedForHuntbot = false;
    this.startAutoFarm();
  }

  private isOwoResponseForMe(message: Message, isMentioned: boolean, nicknameOrDisplayName?: string | null): boolean {
    const userId = this.client.user?.id;
    if (!userId) return false;

    if (!message.guild || message.channel.type === 'DM') return true;
    if (isMentioned) return true;
    if (message.interaction?.user?.id === userId) return true;

    const names = new Set(
      [nicknameOrDisplayName, this.client.user?.username].filter((name): name is string => Boolean(name))
    );

    for (const name of names) {
      if (message.content.includes(name)) return true;

      for (const embed of message.embeds) {
        const fields = [embed.author?.name, embed.description, embed.title, embed.footer?.text];
        if (fields.some((field) => field?.includes(name))) return true;
      }
    }

    return false;
  }

  private getProfileLabel(): string {
    return this.client.user?.username || this.client.user?.id || this.token.slice(0, 12);
  }

  private clearCaptchaTimers(): void {
    this.captchaTimers.forEach(clearTimeout);
    this.captchaTimers = [];
    if (this.captchaSolving) {
      releaseBrowserSlot(this.getProfileLabel());
    }
    this.captchaSolving = false;
  }

  private notifyCaptchaUrgent(message: string, url: string): void {
    notifier.notify({
      title: 'OwO Captcha — ~10 min to solve',
      message: `[${this.client.user?.username}] ${message}`,
      sound: true,
      wait: true,
      open: url,
    });
  }

  private scheduleCaptchaDeadlineWarnings(url: string): void {
    const username = this.client.user?.username ?? 'account';
    const warnAtMinutes = [8, 5, 2, 1];

    for (const minutesLeft of warnAtMinutes) {
      const delay = AutoFarm.CAPTCHA_DEADLINE_MS - minutesLeft * 60 * 1000;
      this.captchaTimers.push(
        setTimeout(() => {
          if (!this.captchaSolving) return;
          const msg = `${minutesLeft} minute(s) left to solve captcha or you may be banned`;
          this.logger.danger(msg);
          this.notifyCaptchaUrgent(msg, url);
        }, delay)
      );
    }

    this.captchaTimers.push(
      setTimeout(() => {
        if (!this.captchaSolving) return;
        releaseBrowserSlot(this.getProfileLabel());
        this.logger.danger(
          'Captcha deadline reached — account may be banned. Solve manually if the page is still open.'
        );
      }, AutoFarm.CAPTCHA_DEADLINE_MS)
    );
  }

  private async openCaptchaInBrowser(url: string): Promise<void> {
    const profileLabel = this.getProfileLabel();

    if (isBrowserQueueEnabled()) {
      this.logger.danger(`Waiting for captcha browser slot [${profileLabel}]...`);
      await acquireBrowserSlot(profileLabel);
      if (!this.captchaSolving) {
        this.logger.info(`Captcha already solved — skipping browser open [${profileLabel}]`);
        return;
      }
      this.logger.danger(`Captcha browser slot acquired [${profileLabel}]`);
    }

    const opened = await openIsolatedUrl(url, profileLabel);
    if (opened) {
      this.logger.danger(`Opened captcha in isolated browser [${profileLabel}]: ${url}`);
      return;
    }
    this.logger.danger(`Could not open browser — solve manually: ${url}`);
  }

  async handleOwoCaptcha() {
    if (!this.botReady && !this.botStatus) return;
    if (this.captchaSolving) return;

    this.captchaSolving = true;
    this.botStatus = false;
    this.botReady = false;
    this.farmPausedForHuntbot = false;
    this.huntbotInitialized = false;
    this.queue = [];
    this.stopProcessing();
    this.huntbot.stop();
    this.stopAutoFarm();

    this.logger.danger('OwO captcha detected — ~10 minutes to solve or account may be banned');

    try {
      const captchaUrl = await getOwoCaptchaUrl(this.token);
      this.notifyCaptchaUrgent('Solve captcha now! Auto-solver also running in background.', captchaUrl);
      void this.openCaptchaInBrowser(captchaUrl);
      this.scheduleCaptchaDeadlineWarnings(captchaUrl);

      if (!process.env.CAPTCHA_API_KEY?.trim()) {
        this.logger.danger('No CAPTCHA_API_KEY — solve manually in the browser tab that just opened');
        return;
      }

      this.logger.info('Auto-solver running in background (browser already opened as fallback)...');

      solveOwoCaptcha(this.token)
        .then((result) => {
          if (!this.captchaSolving) return;

          if (result.success) {
            this.logger.info(`OwO captcha solved automatically — ${result.message}`);
            return;
          }

          this.logger.danger(`Auto-solve failed — use the browser tab: ${result.message}`);
        })
        .catch((error: Error) => {
          if (!this.captchaSolving) return;
          this.logger.danger(`Auto-solve error — use the browser tab: ${error.message}`);
        });
    } catch (error: any) {
      const fallbackUrl = 'https://owobot.com/captcha';
      this.logger.danger(`Captcha handler error — open manually: ${error.message ?? 'unknown error'}`);
      this.notifyCaptchaUrgent('Solve captcha manually in browser', fallbackUrl);
      void this.openCaptchaInBrowser(fallbackUrl);
      this.scheduleCaptchaDeadlineWarnings(fallbackUrl);
    }
  }

  handleOwoSuccessVerification(message: string): void {
    if (this.botStatus) return;

    this.clearCaptchaTimers();
    this.logger.info(`OwO verification success — resuming auto farm (${message})`);
    this.botStatus = true;
    this.botReady = true;
    this.autoChecklist();
    this.startAutoFarm();
  }

  private handleCheckList(message: string): void {
    this.logger.info('Checking checklist 📜');
    if (message.match(/⬛ 🎁/g)) {
      this.addMessage(this.setting.channels.hunt, this.randomPrefix(['daily']));
    }
    this.checkList.daily = true;

    if (message.match(/⬛ 🍪/g)) {
      if (this.setting.status.cookie) {
        this.logger.info('Sending cookie 🍪');
        this.addMessage(
          this.setting.channels.hunt,
          this.randomPrefix(['cookie']) + ` <@${this.setting.target.cookie || this.setting.owoId}>`
        );
        this.checkList.cookie = true;
      }
    }

    this.checkList.vote = message.match(/⬛ 📝/g) ? false : true;
    this.checkList.quest = message.match(/⬛ 📜/g) ? false : true;
    this.checkList.lootbox = message.match(/⬛ 💎/g) ? false : true;
    this.checkList.crate = message.match(/⬛ ⚔/g) ? false : true;

    let checkListMessage: string[] = [];
    for (const key in this.checkList) {
      const value = this.checkList[key as keyof typeof this.checkList];
      checkListMessage.push(`${value ? '✅' : '❌'} ${key}`);
    }

    this.logger.info(`Checklist: ${checkListMessage.join(' | ')}`);

    if (
      this.checkList.daily &&
      this.checkList.cookie &&
      this.checkList.quest &&
      this.checkList.lootbox &&
      this.checkList.crate
    ) {
      this.logger.info('All checklist completed ✅');
      if (this.setting.checklist_completed) this.stopAutoFarm();
    }

    if (!this.botReady && this.botStatus) {
      this.botReady = true;
      this.startAutoFarm();
    }
  }

  private handleHuntGems(message: string): void {
    this.total.hunt += 1;
    const gems: (keyof typeof Gems)[] = [];

    if (!message.includes('gem1')) gems.push('huntgem');
    if (!message.includes('gem3')) gems.push('empgem');
    if (!message.includes('gem4')) gems.push('luckgem');

    if (gems.length > 0) {
      this.logger.info(`Missing gems: ${gems.join(', ')}`);
      if (this.setting.status.gems) {
        let userGems = [];
        for (const gem of gems) {
          let getGem = Object.keys(this.inventory)
            .sort((a, b) => parseInt(b) - parseInt(a))
            .find((item: any) => Gems[gem].includes(item));
          if (getGem) {
            userGems.push(getGem);
          }
        }

        if (userGems.length > 0) this.useGem(userGems);
      }
    }

    let match;
    const xpRegex = /gained \*\*(\d+)xp\*\*/g;
    while ((match = xpRegex.exec(message)) !== null) {
      const xp = parseInt(match[1], 10);
      this.total.hunt_exp += xp;
    }

    this.logger.info(`Total XP from hunting: ${this.total.hunt_exp}`);
  }

  private handleInventory(message: string): void {
    const regex = /`(\d+|2--)`<a?:\w+:\d+>([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g;
    let match;
    const result = {} as { [key: string]: number };

    while ((match = regex.exec(message)) !== null) {
      const quantity: string = match[1];
      const itemCount: number = superscriptToNumber(match[2]);

      result[quantity] = itemCount;
    }
    this.inventory = result;

    if (Items.Crate in this.inventory && this.setting.status.crate) this.openCrate();
    if (Items.Lootbox in this.inventory && this.setting.status.lootbox) this.openLootbox();
    if (Items.LootboxFabled in this.inventory && this.setting.status.lootbox_fabled) this.openLootboxfabled();
  }

  private handleQuest(message: string): void {
    const regex = new RegExp(/\*\*\d+\. (.+?)\*\*.*?Progress: \[(\d+)\/(\d+)\]/, 'gs');
    let match;
    const quests = [];

    while ((match = regex.exec(message)) !== null) {
      const questDescription = match[1];
      const progressCurrent = match[2];
      const progressTotal = match[3];

      quests.push({
        description: questDescription,
        progress: {
          current: parseInt(progressCurrent, 10),
          total: parseInt(progressTotal, 10),
        },
      });
    }

    for (const quest of quests) {
      if (quest.description.match("Say 'owo'")) {
        if (!this.quest['owo']) {
          this.quest['owo'] = {
            status: false,
            progress: {
              current: quest.progress.current,
              total: quest.progress.total,
            },
          };
        }

        if (!this.quest['owo'].status) {
          this.quest['owo'].status = true;
          const intervalId: NodeJS.Timeout = setInterval(() => {
            if (!this.botStatus) return clearInterval(intervalId);

            this.logger.info('Owo quest: owo');
            this.addMessage(this.setting.channels.hunt, 'owo');
            this.quest['owo'].progress.current += 1;

            if (this.quest['owo'].progress.current === this.quest['owo'].progress.total) {
              delete this.quest['owo'];
              clearInterval(intervalId);
            }
          }, this.setting.interval.quest.owo);
        }
      }
    }
  }

  async sendMessage(channelId: string, message: string, force = false): Promise<void> {
    if (!force && !this.botStatus) return this.logger.danger('Bot is not ready');

    let channelToSend = this.client.channels.cache.get(channelId) as TextChannel | undefined;
    if (!channelToSend) {
      try {
        channelToSend = (await this.client.channels.fetch(channelId)) as TextChannel;
      } catch {
        this.logger.danger(
          `Channel not found: ${channelId}. Edit config/${this.client.user?.username}.json (not config.ts).`
        );
        return;
      }
    }

    if (this.setting.typing) await channelToSend.sendTyping();
    channelToSend.send(message).catch((err) => {
      this.logger.danger(`An error occurred while sending a message: ${err}`);
    });
  }

  randomPrefix(message: string[]): string {
    return (
      ['owo', this.setting.prefix || 'owo'][Math.floor(Math.random() * 2)] +
      ' ' +
      message[Math.floor(Math.random() * message.length)]
    );
  }

  private getActionDelay(type: 'hunt' | 'battle'): number {
    const interval = this.setting.interval[type] as {
      minDelay?: number;
      maxDelay?: number;
      slowestTime?: number;
      fastestTime?: number;
    };
    const defaults = config.interval[type];

    const minDelay = interval?.minDelay ?? interval?.slowestTime ?? defaults.minDelay;
    const maxDelay = interval?.maxDelay ?? interval?.fastestTime ?? defaults.maxDelay;

    if (!Number.isFinite(minDelay) || !Number.isFinite(maxDelay)) {
      return defaults.minDelay;
    }

    const min = Math.min(minDelay, maxDelay);
    const max = Math.max(minDelay, maxDelay);
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  async startAutoFarm(): Promise<void> {
    if (!this.botStatus) return this.logger.danger('Bot is not ready');
    this.autoInventory();
    this.autoQuest();
    if (this.setting.status.hunt) this.autoHunt();
    if (this.setting.status.battle) this.autoBattle();
    if (this.setting.status.pray) this.autoPray();
    if (this.setting.status.curse) this.autoCurse();
    if (this.setting.status.zoo) this.autoZoo();

    if (!this.huntbotInitialized && this.huntbot.enabled) {
      this.huntbotInitialized = true;
      void this.huntbot.start();
    }
  }

  private sendCheckList(): void {
    if (!this.botStatus) return;
    this.logger.info('Sending checklist 📜');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['cl', 'checklist']));
  }

  private async autoHunt(): Promise<void> {
    if (!this.botStatus) return;
    this.logger.info('Hunting');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['hunt', 'h']));
    if (!this.botStatus) return;
    this.timeoutId.hunt = setTimeout(() => {
      this.autoHunt();
    }, this.getActionDelay('hunt'));
  }

  private async autoBattle(): Promise<void> {
    if (!this.botStatus || !this.setting.status.battle) return;
    this.logger.info('Battling');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['battle', 'b']));
    if (!this.botStatus) return;
    this.timeoutId.battle = setTimeout(() => {
      this.autoBattle();
    }, this.getActionDelay('battle'));
  }

  private async autoZoo(): Promise<void> {
    if (!this.botStatus || !this.setting.status.zoo) return;
    this.logger.info('Zoo');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['zoo', 'z', 'Z', 'Zoo']));
    if (!this.botStatus) return;
    this.timeoutId.zoo = setTimeout(async () => {
      this.autoZoo();
    }, this.setting.interval.zoo);
  }

  private async autoPray(): Promise<void> {
    if (!this.botStatus || !this.setting.status.pray) return;
    this.logger.info('Praying');
    let txt = this.setting.target.pray ? ` <@${this.setting.target.pray}>` : '';
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['pray']) + txt);
    if (!this.botStatus) return;

    this.timeoutId.pray = setTimeout(async () => {
      this.autoPray();
    }, this.setting.interval.pray);
  }

  private async autoCurse(): Promise<void> {
    if (!this.botStatus || !this.setting.status.curse) return;
    this.logger.info('Cursing');
    let txt = this.setting.target.curse ? ` <@${this.setting.target.curse}>` : '';
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['curse']) + txt);
    if (!this.botStatus) return;

    this.timeoutId.curse = setTimeout(async () => {
      this.autoCurse();
    }, this.setting.interval.curse);
  }

  private async autoChecklist(): Promise<void> {
    if (!this.botStatus) return;
    this.sendCheckList();
    if (!this.botStatus) return;

    this.timeoutId.checklist = setTimeout(async () => {
      this.autoChecklist();
    }, this.setting.interval.checklist);
  }

  private autoInventory(): void {
    if (!this.botStatus || !this.setting.status.inventory) return;
    this.logger.info('Checking inventory 🧾');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['inv', 'inventory']));
    if (!this.botStatus) return;

    this.timeoutId.inventory = setTimeout(async () => {
      this.autoInventory();
    }, this.setting.interval.inventory);
  }

  private autoQuest(): void {
    if (!this.botStatus || !this.setting.status.quest) return;
    this.logger.info('Checking quest 📜');
    this.addMessage(this.setting.channels.quest, this.randomPrefix(['quest', 'q']));
    if (!this.botStatus) return;

    this.timeoutId.quest = setTimeout(async () => {
      this.autoQuest();
    }, this.setting.interval.quest.check);
  }

  private openLootbox(): void {
    if (!this.setting.status.lootbox) return;
    this.logger.info('Opening lootbox 🎁');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['lootbox', 'lb']) + ' all');
  }

  private openLootboxfabled(): void {
    if (!this.setting.status.lootbox_fabled) return;
    this.logger.info('Opening lootbox fabled 🎁');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['lootbox', 'lb']) + ' fabled all');
  }

  private openCrate(): void {
    if (!this.setting.status.crate) return;
    this.logger.info('Opening crate 📦');
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['crate']) + ' all');
  }

  private useGem(gem: string[]): void {
    if (!this.setting.status.gems) return;
    this.logger.info(`Using gem: ${gem.join(', ')}`);
    for (const g of gem) {
      this.inventory[g] -= 1;
      if (this.inventory[g] === 0) delete this.inventory[g];
    }
    this.addMessage(this.setting.channels.hunt, this.randomPrefix(['use']) + ` ${gem.join(' ')}`);
  }

  // Stop all auto farm
  stopAutoFarm(): void {
    for (const id in this.timeoutId) {
      const key = id as keyof typeof this.timeoutId;
      if (this.timeoutId[key]) clearTimeout(this.timeoutId[key]);
      this.timeoutId[key] = 0 as unknown as NodeJS.Timeout;
    }

    if (!this.farmPausedForHuntbot) {
      this.huntbot.stop();
    }
  }

  // Queue management
  public addMessage(channelId: string, message: string): void {
    if (!this.botStatus) return;
    this.queue.push({ channel: channelId, message });

    if (!this.intervalQueueId) {
      this.startProcessing();
    }
  }

  private startProcessing(): void {
    this.intervalQueueId = setInterval(() => {
      if (this.queue.length > 0 && this.botStatus) {
        const queue = this.queue.shift();
        if (queue) {
          this.sendMessage(queue.channel, queue.message);
        }
      } else {
        this.stopProcessing();
      }
    }, this.setting.interval.send_message);
  }

  private stopProcessing(): void {
    if (this.intervalQueueId) {
      clearInterval(this.intervalQueueId);
      this.intervalQueueId = null;
    }
  }
}

export default AutoFarm;
