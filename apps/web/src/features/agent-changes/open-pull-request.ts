import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import { type Accessor, onCleanup } from 'solid-js';
import { parseGithubPrUrl, toGithubKey } from '../block-pr/util/prKey';

/** Resolve the synced PR and use the normal responsive, single-instance split policy. */
export function createPullRequestOpener(url: Accessor<string | undefined>) {
  const { openWithSplit } = useSplitLayout();
  const githubKey = () => {
    const current = url();
    const ref = current ? parseGithubPrUrl(current) : null;
    return ref ? toGithubKey(ref) : undefined;
  };
  const query = usePullRequestByGithubKeyQuery(githubKey);
  let opening = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const open = async (view: 'overview' | 'diff') => {
    const key = githubKey();
    if (!key || opening) return;
    opening = true;
    try {
      const entity =
        (query.isSuccess ? query.data : undefined) ??
        (await query.refetch({ throwOnError: true })).data;
      if (disposed || githubKey() !== key) return;
      if (!entity) {
        toast.failure('This pull request is still syncing. Try again shortly.');
        return;
      }
      const params = { view };
      const result = openWithSplit(
        { type: 'pr', id: entity.id, params },
        { preferNewSplit: true }
      );
      if (result.status === 'unavailable') {
        toast.failure('The pull request could not be opened');
        return;
      }
      // Reusing an open entity only focuses it; explicitly select its tab too.
      const handle = await globalSplitManager()
        ?.getOrchestrator()
        .getBlockHandle(entity.id, 'pr');
      await handle?.goToLocationFromParams(params);
    } catch {
      if (!disposed) toast.failure('The pull request could not be opened');
    } finally {
      opening = false;
    }
  };

  return (view: 'overview' | 'diff') => void open(view);
}
