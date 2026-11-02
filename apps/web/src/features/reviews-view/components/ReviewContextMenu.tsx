import { makeCopyLinkAction } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import type { GithubPullRequestEntity } from '@entity';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import SplitIcon from '@icon/system/regular/columns.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import { ContextMenu } from '@kobalte/core/context-menu';

const copyLink = makeCopyLinkAction();

/** A pull request's right-click actions, for list rows and board cards alike. */
export function ReviewContextMenuContent(props: {
  review: GithubPullRequestEntity;
  onOpen: (foreignEntityId: string, newSplit: boolean) => void;
}) {
  return (
    <ContextMenu.Portal>
      <ContextMenuContent class="min-w-56 max-w-[22rem] text-xs text-ink-muted">
        <MenuItem
          icon={SplitIcon}
          text={t('entityActions.openInNewSplit')}
          disabled={!globalSplitManager()?.canAppendSplit()}
          onClick={() => {
            if (globalSplitManager()?.canAppendSplit())
              props.onOpen(props.review.id, true);
          }}
        />
        <MenuItem
          icon={CopyIcon}
          text={t('entityActions.copyLinkCommand')}
          onClick={() =>
            fireAndForget(copyLink.execute([props.review]), 'reviews-view')
          }
        />
        <MenuItem
          icon={ArrowSquareOutIcon}
          text={t('entityActions.openOnGitHub')}
          onClick={() => openExternalUrl(props.review.metadata.url)}
        />
      </ContextMenuContent>
    </ContextMenu.Portal>
  );
}
