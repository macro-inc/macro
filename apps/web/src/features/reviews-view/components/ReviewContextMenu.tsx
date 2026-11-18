import { makeCopyLinkAction } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  canOpenInNewTab,
  openInNewTab,
} from '@components/app/tab-layout/open-in-new-tab';
import {
  ContextMenuContent,
  CopyMenuItem,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import {
  groupMenuItems,
  type MenuGroup as MenuGroupId,
} from '@core/menu/group-menu-items';
import { openExternalUrl } from '@core/util/url';
import type { GithubPullRequestEntity } from '@entity';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import SplitIcon from '@icon/system/regular/columns.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';

const copyLink = makeCopyLinkAction({ silent: true });
type ReviewAction =
  | 'open-in-split'
  | 'open-in-tab'
  | 'open-on-github'
  | 'copy-link';

/** A pull request's right-click actions, for list rows and board cards alike. */
export function ReviewContextMenuContent(props: {
  review: GithubPullRequestEntity;
  onOpen: (foreignEntityId: string, newSplit: boolean) => void;
}) {
  const groups = () =>
    groupMenuItems(
      [
        'open-in-split',
        ...(canOpenInNewTab() ? (['open-in-tab'] as const) : []),
        'open-on-github',
        'copy-link',
      ] satisfies ReviewAction[],
      (item): MenuGroupId => (item === 'copy-link' ? 'copy' : 'open')
    );
  return (
    <ContextMenu.Portal>
      <ContextMenuContent class="min-w-56 max-w-[22rem] text-xs text-ink-muted">
        <For each={groups()}>
          {(group, index) => (
            <>
              <Show when={index() > 0}>
                <MenuSeparator />
              </Show>
              <MenuGroup>
                <For each={group.items}>
                  {(item) =>
                    match(item)
                      .with('open-in-split', () => (
                        <MenuItem
                          icon={SplitIcon}
                          text={t('entityActions.openInNewSplit')}
                          disabled={!globalSplitManager()?.canAppendSplit()}
                          onClick={() => {
                            if (globalSplitManager()?.canAppendSplit())
                              props.onOpen(props.review.id, true);
                          }}
                        />
                      ))
                      .with('open-in-tab', () => (
                        <MenuItem
                          icon={ArrowSquareOutIcon}
                          text={t('entityActions.openInNewTab')}
                          onClick={() =>
                            openInNewTab(() =>
                              props.onOpen(props.review.id, false)
                            )
                          }
                        />
                      ))
                      .with('open-on-github', () => (
                        <MenuItem
                          icon={ArrowSquareOutIcon}
                          text={t('entityActions.openOnGitHub')}
                          onClick={() =>
                            openExternalUrl(props.review.metadata.url)
                          }
                        />
                      ))
                      .with('copy-link', () => (
                        <CopyMenuItem
                          icon={LinkIcon}
                          text={t('entityActions.copyLinkCommand')}
                          onCopy={() => copyLink.execute([props.review])}
                        />
                      ))
                      .exhaustive()
                  }
                </For>
              </MenuGroup>
            </>
          )}
        </For>
      </ContextMenuContent>
    </ContextMenu.Portal>
  );
}
