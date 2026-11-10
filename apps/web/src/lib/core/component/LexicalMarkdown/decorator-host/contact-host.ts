import type { DecoratorSelectionHost } from './selection-host';

/** Contact's real UI dependencies; selection is the published component state. */
export interface ContactMentionHost extends DecoratorSelectionHost {
  registerNormalEnter(
    listener: (event: KeyboardEvent | null) => boolean
  ): () => void;
}
export interface ContactMentionHostProp {
  readonly host?: ContactMentionHost;
}
