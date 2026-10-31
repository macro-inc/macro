import { t } from '@app/lib/i18n';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import GithubIcon from '@icon/mcp-github.svg';
import GitBranch from '@icon/system/regular/git-branch.svg';
import Link from '@icon/system/regular/link.svg';
import type { Accessor } from 'solid-js';
import type { PrForeignEntityData } from '../data/queries';
import { prHtmlUrl } from '../util/prKey';
import type { PrActions } from './create-pr-actions';

async function copyToClipboard(text: string, confirmation: string) {
  await navigator.clipboard.writeText(text);
  toast.success(confirmation);
}

/**
 * A pull request's "…" menu: the state changes it offers now (Merge only
 * once its checks pass, as on the header button), its GitHub link, and its
 * branch.
 */
export function usePrFileOperations(
  detail: Accessor<PrForeignEntityData | undefined>,
  actions: PrActions
): Accessor<FileOperation[]> {
  return () => {
    const data = detail();
    if (!data) return [];
    const githubUrl = data.pullRequest.url || prHtmlUrl(data.prRef);
    const operations: FileOperation[] = actions
      .all()
      .filter((action) => !action.disabledReason)
      .map((action) => ({
        label: action.label,
        icon: action.icon,
        action: action.run,
      }));

    operations.push(
      {
        group: 'sharing',
        label: t('entityActions.copyGithubLink'),
        icon: Link,
        action: () =>
          fireAndForget(
            copyToClipboard(
              githubUrl,
              t('entityActions.toastGithubLinkCopied')
            ),
            'pr-file-menu'
          ),
      },
      {
        group: 'sharing',
        label: t('entityActions.openOnGitHub'),
        icon: GithubIcon,
        action: () => openExternalUrl(githubUrl),
      }
    );
    const headBranch = data.headBranch;
    if (headBranch) {
      operations.push({
        group: 'sharing',
        label: t('entityActions.copyBranchName'),
        icon: GitBranch,
        action: () =>
          fireAndForget(
            copyToClipboard(
              headBranch,
              t('entityActions.toastBranchNameCopied')
            ),
            'pr-file-menu'
          ),
      });
    }
    return operations;
  };
}
