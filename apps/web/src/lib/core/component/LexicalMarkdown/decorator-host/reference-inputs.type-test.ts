import type {
  PullRequestMentionDecoratorProps,
  SnapshotDecoratorProps,
} from '@macro-inc/lexical-core';
import type { PullRequestMentionUIProps } from '../component/decorator/PullRequestMention';
import type { SnapshotUIProps } from '../component/decorator/Snapshot';

type Assert<T extends true> = T;

export type PrUiKeepsNullLabel = Assert<
  null extends PullRequestMentionUIProps['label'] ? true : false
>;
export type PrUiKeepsNullMentionId = Assert<
  null extends PullRequestMentionUIProps['mentionUuid'] ? true : false
>;
export type SnapshotUiKeepsNullMentionId = Assert<
  null extends SnapshotUIProps['mentionUuid'] ? true : false
>;
export type PublicPrLabelRemainsExact = Assert<
  null extends PullRequestMentionDecoratorProps['label'] ? false : true
>;
export type PublicPrMentionIdRemainsExact = Assert<
  null extends PullRequestMentionDecoratorProps['mentionUuid'] ? false : true
>;
export type PublicSnapshotMentionIdRemainsExact = Assert<
  null extends SnapshotDecoratorProps['mentionUuid'] ? false : true
>;
