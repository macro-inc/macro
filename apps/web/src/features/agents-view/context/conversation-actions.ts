import type { EntityActionViewContext } from '@app/features/next-soup/actions';
import type { SessionCodeDetails } from '../core/session-code-details';

export const AGENTS_ACTION_VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: false,
  supportsOpenInNewSplit: true,
  senderBucket: undefined,
};

export type ConversationActions = {
  openPullRequest: (
    pr: NonNullable<SessionCodeDetails['pullRequest']>,
    event: MouseEvent
  ) => void;
  openBranch: (url: string) => void;
  copyBranch: (name: string) => Promise<boolean>;
  unarchive: (id: string) => Promise<boolean>;
};
