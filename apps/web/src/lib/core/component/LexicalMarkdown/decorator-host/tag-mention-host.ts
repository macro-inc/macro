import type { TagMentionInfo } from '@macro-inc/lexical-core';
import type { NormalEnterHost } from './native-enter-host';

/** TagMention's editor dependencies: selection, Normal Enter and the resolved-info write. */
export interface TagMentionHost extends NormalEnterHost {
  setTagInfo(key: string, info: Omit<TagMentionInfo, 'optionId'>): void;
}
export interface TagMentionHostProp {
  readonly host?: TagMentionHost;
}
