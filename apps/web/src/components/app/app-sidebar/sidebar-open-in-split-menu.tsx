import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  SplitContent,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { type JSX, Show } from 'solid-js';

/** Which action of {@link SidebarOpenInSplitMenu} placed the content. */
export type SidebarOpenAction = 'current-split' | 'new-split' | 'fullscreen';

export type SidebarOpenInSplitMenuProps = {
  /** The content the menu's actions open. */
  content: () => SplitContent;
  /**
   * Runs once an action has placed the content in a split — e.g. the Email
   * account rows scope the freshly opened mail list to their inbox.
   */
  onOpened?: (split: SplitHandle, action: SidebarOpenAction) => void;
  onOpenChange?: (open: boolean) => void;
  /** Extra classes on the context-menu trigger. */
  triggerClass?: string;
  children: JSX.Element;
};

/**
 * The shared sidebar right-click menu: open the row's content in the current
 * split, in a new split, or fullscreen. Wraps any sidebar row — the top-level
 * links and the nested Email account rows both use it.
 */
export function SidebarOpenInSplitMenu(props: SidebarOpenInSplitMenuProps) {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? true;
  const canOpenFullscreen = () => layout.getSplitCount() > 1;

  const openInCurrentSplit = () => {
    const split = layout.openWithSplit(props.content(), {
      allowDuplicate: true,
      mergeHistory: false,
      referredFrom: 'sidebar',
    });
    if (split) props.onOpened?.(split, 'current-split');
  };

  const openInNewSplit = () => {
    const manager = globalSplitManager();
    if (!manager?.canAppendSplit()) return;

    analytics.track('split_created', { from: 'sidebar' });

    const split = manager.createNewSplit({
      content: props.content(),
      activate: true,
      allowDuplicate: true,
      referredFrom: 'sidebar',
    });
    props.onOpened?.(split, 'new-split');
  };

  const openFullscreen = () => {
    const split = layout.replaceAllSplits(props.content(), {
      referredFrom: 'sidebar',
    });
    if (split) props.onOpened?.(split, 'fullscreen');
    globalSplitManager()?.returnFocus();
  };

  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenu.Trigger as="div" class={props.triggerClass ?? 'w-full h-7'}>
        {props.children}
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuItem
            text="Open in new split"
            onClick={openInNewSplit}
            disabled={!canOpenInNewSplit()}
          />
          <Show when={canOpenFullscreen()}>
            <MenuItem text="Open fullscreen" onClick={openFullscreen} />
          </Show>
          <MenuItem text="Open in current split" onClick={openInCurrentSplit} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
