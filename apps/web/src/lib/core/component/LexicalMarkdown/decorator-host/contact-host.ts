import type { NormalEnterHost } from './native-enter-host';

/** Contact's real UI dependencies; selection is the published component state. */
export type ContactMentionHost = NormalEnterHost;
export interface ContactMentionHostProp {
  readonly host?: ContactMentionHost;
}
