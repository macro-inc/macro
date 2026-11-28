import type { Accessor } from 'solid-js';
import type { PrActionKey } from '../primitives/create-pr-actions';
import type { PrPageComment, PrPageLineAnchor } from './pr-page-read-model';

/** A missing run function means the capability is unavailable; never offer a fake write. */
export type PrPageAction<Args extends unknown[] = []> = {
  available: Accessor<boolean>;
  run?: (...args: Args) => void | Promise<void>;
};

/** Page writes. Each stub stays unavailable in live mode. */
export type PrPageActions = {
  /** Live: existing GitHub merge, draft, close, and reopen actions. */
  changeState: PrPageAction<[key: PrActionKey]> & {
    availableFor: (key: PrActionKey) => boolean;
  };
  pending: Accessor<boolean>;
  /** Stub: no backend mutation exists for these actions. */
  mergeWhenReady: PrPageAction<[enabled?: boolean]>;
  rerunChecks: PrPageAction<[checkId: number]>;
  comment: PrPageAction<[body: string, anchor?: PrPageLineAnchor]>;
  reply: PrPageAction<[commentId: number, body: string]>;
  addToReview: PrPageAction<[comment: PrPageComment]>;
  submitReview: PrPageAction<
    [state: 'approved' | 'changes_requested' | 'commented', body: string]
  >;
  resolveThread: PrPageAction<[commentId: number]>;
  commitSuggestion: PrPageAction<[commentId: number]>;
  markViewed: PrPageAction<[path: string, viewed: boolean]>;
  linkTask: PrPageAction<[taskId: string]>;
};
