export type HuntbotTrait = 'efficiency' | 'duration' | 'cost' | 'gain' | 'exp' | 'radar';

export const HUNTBOT_TRAITS: HuntbotTrait[] = ['efficiency', 'duration', 'cost', 'gain', 'exp', 'radar'];

export interface TraitState {
  enabled: boolean;
  current_level: number;
  invested: number;
}

export interface UpgradeDetails {
  essence: number;
  efficiency: TraitState;
  duration: TraitState;
  cost: TraitState;
  gain: TraitState;
  exp: TraitState;
  radar: TraitState;
}

export interface HuntbotWeights {
  efficiency: number;
  duration: number;
  cost: number;
  gain: number;
  exp: number;
  radar: number;
}

export interface HuntbotUpgraderSettings {
  enabled: boolean;
  sleeptime: [number, number] | number | null;
  traits: Record<HuntbotTrait, boolean>;
  weights: HuntbotWeights;
}

export interface HuntbotSettings {
  enabled: boolean;
  cashToSpend: number;
  upgrader: HuntbotUpgraderSettings;
}

export interface CommandPayload {
  cmd_name: string;
  cmd_arguments: string;
  prefix: boolean;
  checks: boolean;
  id: string;
}

export interface EmbedField {
  name: string;
  value: string;
}

export interface EmbedAuthor {
  name?: string;
}

export interface MessageEmbed {
  author?: EmbedAuthor;
  fields?: EmbedField[];
}

export interface MessageAttachment {
  url: string;
}

export interface HuntbotMessage {
  channelId: string | number;
  authorId: string | number;
  content: string;
  embeds?: MessageEmbed[];
  attachments?: MessageAttachment[];
}

export interface HuntbotBotContext {
  cmChannelId: string | number;
  owoBotId: string | number;
  getNick(message: HuntbotMessage): string;
  session: {
    get(url: string): Promise<Response>;
  };
  settings: {
    huntbot: HuntbotSettings;
    cooldowns: {
      briefCooldown: number | [number, number];
    };
  };
  alias: {
    huntbot: { normal: string };
    upgrade: { normal: string };
  };
  log(message: string, color: string): Promise<void>;
  putQueue(cmd: CommandPayload, options?: { priority?: boolean }): Promise<void>;
  removeQueue(options: { id: string }): Promise<void>;
  setStat(enabled: boolean): Promise<void>;
  sleep(seconds: number): Promise<void>;
  sleepTill(cooldown: number | [number, number], options?: { cdList?: boolean; noise?: number }): Promise<void>;
}
