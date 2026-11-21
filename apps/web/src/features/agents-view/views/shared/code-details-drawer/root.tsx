import {
  parseGithubPrUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import { createSignal, type ParentProps } from 'solid-js';
import type { SessionCodeDetails } from '../../../core/session-code-details';
import { type CodeDetailsActions, CodeDetailsContext } from './context';

export function CodeDetailsRoot(
  props: ParentProps<{
    details: SessionCodeDetails;
    actions: CodeDetailsActions;
  }>
) {
  const [open, setOpen] = createSignal(false);
  const githubKey = () => {
    const pr = props.details.pullRequest;
    if (!pr || pr.id) return undefined;
    const parsed = parseGithubPrUrl(pr.url);
    return parsed ? toGithubKey(parsed) : undefined;
  };
  const query = usePullRequestByGithubKeyQuery(githubKey, open);
  const branchUrl = () => {
    const { repository, branch } = props.details;
    if (!repository || !branch) return undefined;
    return `https://github.com/${repository}/tree/${encodeURIComponent(branch)}`;
  };
  return (
    <CodeDetailsContext.Provider
      value={{
        details: () => props.details,
        actions: props.actions,
        pullRequestId: () =>
          props.details.pullRequest?.id ??
          (query.isSuccess ? query.data?.id : undefined),
        branchUrl,
      }}
    >
      <MobileDrawer side="bottom" open={open()} onOpenChange={setOpen}>
        {props.children}
      </MobileDrawer>
    </CodeDetailsContext.Provider>
  );
}
