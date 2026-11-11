import type { MagicChipHost } from './magic-host';
import type { NormalEnterHost } from './native-enter-host';

/** AgentSessionMention's editor dependencies, including its expanded Magic Chip. */
export interface AgentSessionMentionHost extends NormalEnterHost {
  previewFetchEnabled(): boolean;
  isInteractable(): boolean;
  setExpanded(key: string, expanded: boolean): void;
  normalize(key: string): void;
  readonly magic: MagicChipHost;
}
export interface AgentSessionMentionHostProp {
  readonly host?: AgentSessionMentionHost;
}
