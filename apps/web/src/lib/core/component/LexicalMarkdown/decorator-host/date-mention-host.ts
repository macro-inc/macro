import type { NormalEnterHost } from './native-enter-host';

/** DateMention's editor dependencies: selection, Normal Enter, updates and the picker write. */
export interface DateMentionHost extends NormalEnterHost {
  registerUpdateListener(listener: () => void): () => void;
  setDate(key: string, date: string, displayFormat: string): void;
}
export interface DateMentionHostProp {
  readonly host?: DateMentionHost;
}
