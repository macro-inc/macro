import { t } from '@app/lib/i18n';
import { type PaneId, useSplitRouter } from '@app/lib/split-router';
import { defaultViewContent } from '@components/app/sidebar-next/default-view';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { TOKENS } from '@core/hotkey/tokens';
import ArrowClockwise from '@icon/system/regular/arrow-clockwise.svg';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import CollapseIcon from '@icon/system/regular/arrows-in.svg';
import ExpandIcon from '@icon/system/regular/arrows-out.svg';
import SplitIcon from '@icon/system/regular/columns.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import StackIcon from '@icon/system/regular/rows.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  DomCollectionContext,
  useOptionalDomCollectionContext,
} from '@kobalte/core/primitives/create-dom-collection';
import { createMemo, type ParentProps, useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import type { SplitContent, SplitPlacement } from '../layoutManager';
import { shouldShowSplitCloseButton } from '../layoutUtils';
import { canSpotlight } from '../utils/canSpotlight';

/** Split actions shared by legacy split chrome and composable view top bars. */
export function SplitHeaderContextMenu(props: ParentProps) {
  const panel = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!panel || !layout) return props.children;

  // Kobalte's menu provides its item collection around the trigger too. Hand
  // the header the collection it sits in, or tabs whose root wraps the header
  // join the menu's collection and stop responding.
  const collection = useOptionalDomCollectionContext();
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
  const canSplitToward = (side: SplitPlacement['side']) =>
    layout.manager.canSplit(panel.handle.id, side);

  const duplicateContent = (): SplitContent => ({ ...panel.handle.content() });

  const insertSplitBeside = (
    side: SplitPlacement['side'],
    content: SplitContent
  ) => {
    layout.manager.createNewSplit({
      content,
      activate: true,
      allowDuplicate: true,
      beside: { split: panel.handle.id, side },
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
        <DomCollectionContext.Provider value={collection}>
          {props.children}
        </DomCollectionContext.Provider>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent class="min-w-60 max-w-[min(22rem,calc(100vw-1rem))]">
          <MenuItem
            icon={SplitIcon}
            iconClass="rotate-180"
            text={t('splitMenu.newSplitLeft')}
            disabled={!canSplitToward('left')}
            onClick={() => insertSplitBeside('left', defaultViewContent())}
          />
          <MenuItem
            icon={SplitIcon}
            text={t('splitMenu.newSplitRight')}
            disabled={!canSplitToward('right')}
            onClick={() => insertSplitBeside('right', defaultViewContent())}
          />
          <MenuItem
            icon={StackIcon}
            text={t('splitMenu.newSplitAbove')}
            disabled={!canSplitToward('above')}
            onClick={() => insertSplitBeside('above', defaultViewContent())}
          />
          <MenuItem
            icon={StackIcon}
            hotkeyToken={TOKENS.global.createNewSplitBelow}
            text={t('splitMenu.newSplitBelow')}
            disabled={!canSplitToward('below')}
            onClick={() => insertSplitBeside('below', defaultViewContent())}
          />
          <MenuItem
            icon={CopyIcon}
            text={t('splitMenu.duplicateSplit')}
            disabled={!canSplitToward('right') || !canDuplicateSplit()}
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
            onClick={() => layout.manager.resetSizes()}
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
