import { LIST_VIEW_ID } from '@app/constants/list-views';
import { t } from '@app/lib/i18n';
import { type PaneId, useSplitRouter } from '@app/lib/split-router';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { TOKENS } from '@core/hotkey/tokens';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import CollapseIcon from '@phosphor/arrows-in.svg';
import ExpandIcon from '@phosphor/arrows-out.svg';
import SplitIcon from '@phosphor/columns.svg';
import CopyIcon from '@phosphor/copy.svg';
import CloseIcon from '@phosphor/x.svg';
import { createMemo, type ParentProps, useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import type { SplitContent } from '../layoutManager';
import { shouldShowSplitCloseButton } from '../layoutUtils';
import { canSpotlight } from '../utils/canSpotlight';

/** Split actions shared by legacy split chrome and composable view top bars. */
export function SplitHeaderContextMenu(props: ParentProps) {
  const panel = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!panel || !layout) return props.children;

  const router = useSplitRouter();
  const splitIndex = createMemo(() =>
    layout.manager.splits().findIndex((split) => split.id === panel.handle.id)
  );
  const hasOtherSplits = createMemo(() => layout.manager.splits().length > 1);
  const canCloseSplit = createMemo(() =>
    shouldShowSplitCloseButton(layout.manager)
  );
  const canDuplicateSplit = createMemo(
    () => panel.handle.content().type === 'component'
  );
  const canToggleSpotlight = createMemo(() => canSpotlight(layout.manager));
  const canSwapWith = (direction: 'left' | 'right') =>
    layout.manager.canSwapSplit(panel.handle.id, direction);

  const newSplitContent = () => ({
    type: 'component' as const,
    id: LIST_VIEW_ID.home,
  });

  const duplicateContent = (): SplitContent => ({ ...panel.handle.content() });

  const insertSplitBeside = (side: 'left' | 'right', content: SplitContent) => {
    const index = splitIndex();
    if (index < 0) return;

    const insertIndex = side === 'left' ? index : index + 1;

    layout.manager.createNewSplit({
      content,
      activate: true,
      allowDuplicate: true,
      insertIndex,
      referredFrom: null,
    });
  };

  const copyDebugInfo = async () => {
    try {
      const splits = layout.manager.splits();
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            activeSplitId: layout.manager.activeSplitId(),
            currentSplitId: panel.handle.id,
            currentSplitIndex: splitIndex(),
            currentSplitUrl: router.href(panel.handle.id as string as PaneId),
            splits: splits.map((split, index) => ({
              index,
              id: split.id,
              content: split.content,
              referredFrom: split.referredFrom,
              isCurrent: split.id === panel.handle.id,
            })),
          },
          null,
          2
        )
      );
      toast.success(t('splitMenu.toastDebugInfoCopied'));
    } catch (error) {
      console.error('Failed to copy split debug info', error);
      toast.failure(t('splitMenu.toastCopyDebugInfoFailed'));
    }
  };

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="contents">
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent class="min-w-60 max-w-[min(22rem,calc(100vw-1rem))]">
          <MenuItem
            icon={SplitIcon}
            iconClass="rotate-180"
            text={t('splitMenu.newSplitLeft')}
            disabled={!layout.manager.canAppendSplit()}
            onClick={() => insertSplitBeside('left', newSplitContent())}
          />
          <MenuItem
            icon={SplitIcon}
            text={t('splitMenu.newSplitRight')}
            disabled={!layout.manager.canAppendSplit()}
            onClick={() => insertSplitBeside('right', newSplitContent())}
          />
          <MenuItem
            icon={CopyIcon}
            text={t('splitMenu.duplicateSplit')}
            disabled={!layout.manager.canAppendSplit() || !canDuplicateSplit()}
            onClick={() => insertSplitBeside('right', duplicateContent())}
          />
          <MenuSeparator />
          <MenuItem
            icon={ArrowLeft}
            text={t('splitMenu.swapSplitLeft')}
            disabled={!canSwapWith('left')}
            onClick={() => layout.manager.swapSplit(panel.handle.id, 'left')}
          />
          <MenuItem
            icon={ArrowRight}
            text={t('splitMenu.swapSplitRight')}
            disabled={!canSwapWith('right')}
            onClick={() => layout.manager.swapSplit(panel.handle.id, 'right')}
          />
          <MenuSeparator />
          <MenuItem
            icon={panel.handle.isSpotLight() ? CollapseIcon : ExpandIcon}
            hotkeyToken={TOKENS.window.spotlight.toggle}
            text={
              panel.handle.isSpotLight()
                ? t('splitMenu.minimizeSplit')
                : t('splitMenu.spotlightSplit')
            }
            disabled={!canToggleSpotlight()}
            onClick={() => panel.handle.toggleSpotlight()}
          />
          <MenuItem
            icon={CloseIcon}
            hotkeyToken={TOKENS.split.close}
            text={t('splitMenu.closeSplit')}
            disabled={!canCloseSplit()}
            onClick={() => panel.handle.close()}
          />
          <MenuSeparator />
          <MenuItem
            icon={CloseIcon}
            text={t('splitMenu.closeOtherSplits')}
            disabled={!hasOtherSplits()}
            onClick={() => {
              const currentSplitId = panel.handle.id;
              const otherSplitIds = layout.manager
                .splits()
                .map((split) => split.id)
                .filter((id) => id !== currentSplitId);

              for (const splitId of otherSplitIds) {
                layout.manager.removeSplit(splitId);
              }

              layout.manager.activateSplit(currentSplitId);
            }}
          />
          <MenuItem
            icon={ArrowClockwise}
            text={t('splitMenu.resetSizes')}
            disabled={!hasOtherSplits()}
            onClick={() => layout.manager.resizeContext()?.reset()}
          />
          <MenuSeparator />
          <MenuItem
            icon={CopyIcon}
            text={t('splitMenu.copyDebugInfo')}
            onClick={copyDebugInfo}
          />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
