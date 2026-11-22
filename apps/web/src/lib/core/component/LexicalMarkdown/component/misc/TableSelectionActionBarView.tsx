/**
 * @file Floating cut/copy/paste/merge/split bar shown over a table cell
 * selection on touch devices, where there is no keyboard shortcut or context
 * menu for the clipboard and no format popup for table selections. On
 * desktop, merge/split live in the normal selection popup (FormatTools).
 * Each editor engine supplies a TableSelectionActionsHost.
 */
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import {
  readClipboardAsDataTransfer,
  writeClipboardData,
} from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import ClipboardIcon from '@icon/system/regular/clipboard.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import CornersInIcon from '@icon/system/regular/corners-in.svg';
import CornersOutIcon from '@icon/system/regular/corners-out.svg';
import ScissorsIcon from '@icon/system/regular/scissors.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Layer } from '@ui';
import {
  type Component,
  type ComponentProps,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { floatWithElement } from '../../directive/floatWithElement';
import type { TableSelectionActionsHost } from '../../editing/overlay-hosts/table-selection-actions';
import { createLayoutTick } from './createLayoutTick';

false && floatWithElement;

export function TableSelectionActionBarView<Key>(props: {
  host: TableSelectionActionsHost<Key>;
}) {
  const host = props.host;

  const [anchorCellKey, setAnchorCellKey] = createSignal<Key>();
  const [focusCellKey, setFocusCellKey] = createSignal<Key>();
  const [hasMergedCell, setHasMergedCell] = createSignal(false);
  const { layoutTick, bumpLayout } = createLayoutTick();

  const isMultiCell = () => anchorCellKey() !== focusCellKey();

  const trackSelection = createCallback(() => {
    const tracked = host.tracked();
    setAnchorCellKey(() => tracked?.anchor);
    setFocusCellKey(() => tracked?.focus);
    setHasMergedCell(tracked?.merged ?? false);
  });

  const removeSelectionListener = host.registerSelection(trackSelection);
  const removeUpdateListener = host.registerLayout(() => {
    trackSelection();
    bumpLayout();
  });
  // Tapping outside the editor blurs it without a selection change; the
  // selection the bar acted on is gone, so hide it. (Bar taps themselves
  // preventDefault pointerdown and never blur.)
  const removeBlurListener = host.registerBlur(() => {
    setAnchorCellKey(undefined);
    setFocusCellKey(undefined);
    setHasMergedCell(false);
  });

  onCleanup(() => {
    removeSelectionListener();
    removeUpdateListener();
    removeBlurListener();
  });

  // Bounding rect of the union of the anchor and focus cells; an invisible
  // fixed div at this rect anchors the floating bar.
  const anchorRect = createMemo(() => {
    layoutTick();
    const aKey = anchorCellKey();
    const fKey = focusCellKey();
    if (aKey === undefined || fKey === undefined) return;

    const a = host.elementFor(aKey)?.getBoundingClientRect();
    const f = host.elementFor(fKey)?.getBoundingClientRect();
    if (!a || !f) return;

    const left = Math.min(a.left, f.left);
    const top = Math.min(a.top, f.top);
    return {
      left,
      top,
      width: Math.max(a.right, f.right) - left,
      height: Math.max(a.bottom, f.bottom) - top,
    };
  });

  // Collapse the selection so the bar dismisses after an action, the way a
  // normal context menu closes once you pick something.
  const clearSelection = createCallback(() => host.clearSelection());

  const runCut = createCallback(async () => {
    const data = host.clipboardData();
    if (!data) return;
    if (!(await writeClipboardData(data))) {
      toast.failure('Failed to cut cells');
      return;
    }
    host.clearCells();
  });

  const runCopy = createCallback(async () => {
    const data = host.clipboardData();
    if (!data) return;
    if (await writeClipboardData(data)) {
      toast.success('Copied cells');
      // Dismiss the bar once the action is taken, like a normal menu.
      clearSelection();
    }
  });

  const runMerge = createCallback(() => host.merge());

  const runSplit = createCallback(() => host.split());

  // Replays the system clipboard through the engine's normal paste pipeline
  // (which routes a copied cell range through the table grid overlay), then
  // collapses the selection so the bar dismisses. Passing the DataTransfer
  // directly avoids a synthetic ClipboardEvent, whose clipboardData is null
  // on WebKit/mobile — the reason paste silently did nothing there.
  const runPaste = createCallback(async () => {
    const dataTransfer = await readClipboardAsDataTransfer();
    if (!dataTransfer) {
      toast.failure('Nothing to paste');
      return;
    }
    host.paste(dataTransfer);
  });

  const barButton = (
    label: string,
    icon: Component<ComponentProps<'svg'>>,
    onClick: () => void,
    danger?: boolean
  ) => {
    const Icon = icon;
    return (
      <button
        type="button"
        aria-label={label}
        class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm active:bg-accent/10"
        classList={{ 'text-failure': danger, 'text-ink-muted': !danger }}
        onPointerDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        <Icon class="size-4" />
        {label}
      </button>
    );
  };

  const [anchorElem, setAnchorElem] = createSignal<HTMLDivElement>();

  return (
    <Show when={anchorRect()}>
      {(rect) => (
        <ScopedPortal scope="split">
          {/* Same elevated surface as the other floating bars. */}
          <Layer depth={2}>
            <div
              ref={setAnchorElem}
              class="pointer-events-none fixed"
              style={{
                left: `${rect().left}px`,
                top: `${rect().top}px`,
                width: `${rect().width}px`,
                height: `${rect().height}px`,
              }}
            />
            <div
              class="menu-surface z-30 flex items-center gap-0.5 p-1"
              use:floatWithElement={{
                element: anchorElem,
                floatingOptions: { placement: 'top' },
              }}
            >
              {barButton('Cut', ScissorsIcon, () =>
                fireAndForget(runCut(), 'markdown-table-actions')
              )}
              {barButton('Copy', CopyIcon, () =>
                fireAndForget(runCopy(), 'markdown-table-actions')
              )}
              {barButton('Paste', ClipboardIcon, () =>
                fireAndForget(runPaste(), 'markdown-table-actions')
              )}
              <Show when={isMultiCell()}>
                {barButton('Merge', CornersInIcon, runMerge)}
              </Show>
              <Show when={hasMergedCell()}>
                {barButton('Split', CornersOutIcon, runSplit)}
              </Show>
            </div>
          </Layer>
        </ScopedPortal>
      )}
    </Show>
  );
}
