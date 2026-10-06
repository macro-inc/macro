import type { LegacyReviewNote } from '@app/features/changes/agent-session-changes';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { ReviewFile } from '../core/model';
import type { ReviewData, ReviewSource } from '../core/source';
export type ReviewHost = {
  createSource: (
    revision: Accessor<number | undefined>,
    active: Accessor<boolean>
  ) => ReviewSource;
  createFile: (
    revision: Accessor<number | undefined>,
    path: Accessor<string | undefined>,
    active: Accessor<boolean>
  ) => ReviewData<ReviewFile>;
  savedNotes: Accessor<LegacyReviewNote[]>;
  sessionId: Accessor<string | undefined>;
  canEdit: Accessor<boolean>;
  userId: Accessor<string | undefined>;
  displayName: (user: string) => string;
  open: Accessor<boolean>;
  available: Accessor<boolean>;
  reviewId: Accessor<string | undefined>;
  revision: Accessor<number | undefined>;
  target: Accessor<string | undefined>;
  navigation: Accessor<number>;
  thread: Accessor<string | undefined>;
  show: () => void;
  back: () => void;
  /** Select a revision and clear citation/thread keys; routing may settle later. */
  selectRevision: (revision: number) => void;
  openLink: (url: string) => boolean;
};
export const ReviewHostContext = createContext<ReviewHost>();
export function useReviewHost() {
  const host = useContext(ReviewHostContext);
  if (!host) throw new Error('AgentReviewProvider is required');
  return host;
}
export function useOptionalReviewHost() {
  return useContext(ReviewHostContext);
}
