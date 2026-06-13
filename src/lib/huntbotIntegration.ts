import {
  HuntbotHandler,
  type CommandPayload,
  type HuntbotBotContext,
  type HuntbotMessage,
  type HuntbotSettings,
} from '../huntbot';
import Logger from '../tools/logger';
import sleep from '../tools/sleep';

export interface HuntbotHost {
  token: string;
  huntChannelId: string;
  owoBotId: string;
  getHuntbotSettings(): HuntbotSettings;
  getNickname(): string;
  randomPrefix(commands: string[]): string;
  sendHuntbotMessage(channelId: string, message: string): Promise<void>;
  pauseFarmForHuntbot(): void;
  resumeFarmFromHuntbot(): void;
  logger: Logger;
}

export class HuntbotIntegration {
  private handler: HuntbotHandler | null = null;
  private sleepAbort: (() => void) | null = null;

  constructor(private readonly host: HuntbotHost) {}

  get enabled(): boolean {
    return this.host.getHuntbotSettings().enabled;
  }

  private cancelSleep(): void {
    this.sleepAbort?.();
    this.sleepAbort = null;
  }

  private cooldownToMs(cooldown: number | [number, number], noise = 0): number {
    let seconds: number;

    if (Array.isArray(cooldown)) {
      seconds = cooldown[0] + Math.random() * (cooldown[1] - cooldown[0]);
    } else {
      seconds = cooldown + Math.random() * noise;
    }

    return Math.max(0, seconds * 1000);
  }

  private createContext(): HuntbotBotContext {
    const briefCooldown: [number, number] = [5, 8];

    return {
      cmChannelId: this.host.huntChannelId,
      owoBotId: this.host.owoBotId,
      getNick: (_message: HuntbotMessage) => this.host.getNickname(),
      session: {
        get: (url: string) =>
          fetch(url, {
            headers: { Authorization: this.host.token },
          }),
      },
      settings: {
        huntbot: this.host.getHuntbotSettings(),
        cooldowns: { briefCooldown },
      },
      alias: {
        huntbot: { normal: 'huntbot' },
        upgrade: { normal: 'upgrade' },
      },
      log: async (message: string) => {
        this.host.logger.info(message);
      },
      putQueue: async (cmd: CommandPayload) => {
        const commands = cmd.id === 'huntbot' ? ['huntbot', 'ah', 'hb', 'autohunt'] : ['upgrade'];
        const args = cmd.cmd_arguments ? ` ${cmd.cmd_arguments}` : '';
        const message = this.host.randomPrefix(commands) + args;
        await this.host.sendHuntbotMessage(this.host.huntChannelId, message);
      },
      removeQueue: async ({ id }) => {
        if (id === 'huntbot' || id === 'upgrade') {
          this.cancelSleep();
        }
      },
      setStat: async (enabled: boolean) => {
        if (enabled) {
          this.host.resumeFarmFromHuntbot();
        } else {
          this.host.pauseFarmForHuntbot();
        }
      },
      sleep: async (seconds: number) => {
        await sleep(seconds * 1000);
      },
      sleepTill: async (cooldown, options) => {
        this.cancelSleep();

        const ms = this.cooldownToMs(cooldown, options?.noise ?? 0);

        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.sleepAbort = null;
            resolve();
          }, ms);

          this.sleepAbort = () => {
            clearTimeout(timer);
            this.sleepAbort = null;
            resolve();
          };
        });
      },
    };
  }

  private ensureHandler(): HuntbotHandler {
    if (!this.handler) {
      this.handler = new HuntbotHandler(this.createContext());
    }

    return this.handler;
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.ensureHandler().onLoad();
  }

  async handleMessage(message: HuntbotMessage): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.ensureHandler().onMessage(message);
  }

  stop(): void {
    this.cancelSleep();
    void this.handler?.onUnload();
    this.handler = null;
  }
}
