import { type Accessor, createContext, useContext } from 'solid-js';
import type { ConversationActions } from '../../../context/conversation-actions';
import type { SessionCodeDetails } from '../../../core/session-code-details';

export type CodeDetailsActions = Pick<
  ConversationActions,
  'openPullRequest' | 'openBranch' | 'copyBranch'
>;
export type CodeDetailsState = {
  details: Accessor<SessionCodeDetails>;
  actions: CodeDetailsActions;
  pullRequestId: Accessor<string | undefined>;
  branchUrl: Accessor<string | undefined>;
};
export const CodeDetailsContext = createContext<CodeDetailsState>();
export function useCodeDetails() {
  const state = useContext(CodeDetailsContext);
  if (!state) throw new Error('CodeDetailsRoot is required');
  return state;
}
