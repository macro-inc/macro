/**
 * @file Floating cut/copy/clear bar shown over a table cell selection on
 * touch devices, where there is no keyboard shortcut or context menu to
 * reach the clipboard.
 */
import { mdStore } from '@block-md/signal/markdownBlockData';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { readClipboardAsDataTransfer } from '@core/util/dataTransfer';
import {
  $getClipboardDataFromSelection,
  copyToClipboard,
} from '@lexical/clipboard';
import {
  $getTableCellNodeFromLexicalNode,
  $isTableSelection,
} from '@lexical/table';
import ClipboardIcon from '@phosphor/clipboard.svg';
import CopyIcon from '@phosphor/copy.svg';
import EraserIcon from '@phosphor/eraser.svg';
import ScissorsIcon from '@phosphor/scissors.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Layer } from '@ui';
import {
  $getSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  CUT_COMMAND,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import {
  type Component,
  type ComponentProps,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { floatWithElement } from '../../directive/floatWithElement';
import { $clearSelectedCells } from '../../plugins/tables/tableClipboardPlugin';

false && floatWithElement;

export function TableSelectionActionBar() {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [anchorCellKey, setAnchorCellKey] = createSignal<string>();
  const [focusCellKey, setFocusCellKey] = createSignal<string>();
  // Bumped on scroll/resize/updates to recompute viewport-fixed positions.
  const [layoutTick, setLayoutTick] = createSignal(0);
  const bumpLayout = () => setLayoutTick((t) => t + 1);

  const trackSelection = createCallback(() => {
    const currentEditor = editor();
    if (!currentEditor) return;
    currentEditor.read(() => {
      const selection = $getSelection();
      if (!$isTableSelection(selection)) {
        setAnchorCellKey(undefined);
        setFocusCellKey(undefined);
        return;
      }
      const anchorCell = $getTableCellNodeFromLexicalNode(
        selection.anchor.getNode()
      );
      const focusCell = $getTableCellNodeFromLexicalNode(
        selection.focus.getNode()
      );
      setAnchorCellKey(anchorCell?.getKey());
      setFocusCellKey(focusCell?.getKey());
    });
  });

  const removeSelectionListener = editor()?.registerCommand(
    SELECTION_CHANGE_COMMAND,
    () => {
      trackSelection();
      return false;
    },
    COMMAND_PRIORITY_LOW
  );
  const removeUpdateListener = editor()?.registerUpdateListener(() => {
    trackSelection();
    bumpLayout();
  });
  // Tapping outside the editor blurs it without a selection change; the
  // selection the bar acted on is gone, so hide it. (Bar taps themselves
  // preventDefault pointerdown and never blur.)
  const removeBlurListener = editor()?.registerCommand(
    BLUR_COMMAND,
    () => {
      setAnchorCellKey(undefined);
      setFocusCellKey(undefined);
      return false;
    },
    COMMAND_PRIORITY_LOW
  );

  document.addEventListener('scroll', bumpLayout, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', bumpLayout);

  onCleanup(() => {
    removeSelectionListener?.();
    removeUpdateListener?.();
    removeBlurListener?.();
    document.removeEventListener('scroll', bumpLayout, { capture: true });
    window.removeEventListener('resize', bumpLayout);
  });

  // Bounding rect of the union of the anchor and focus cells; an invisible
  // fixed div at this rect anchors the floating bar.
  const anchorRect = createMemo(() => {
    layoutTick();
    const currentEditor = editor();
    const aKey = anchorCellKey();
    const fKey = focusCellKey();
    if (!currentEditor || !aKey || !fKey) return;

    const a = currentEditor.getElementByKey(aKey)?.getBoundingClientRect();
    const f = currentEditor.getElementByKey(fKey)?.getBoundingClientRect();
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

  const runCut = createCallback(() => {
    editor()?.dispatchCommand(CUT_COMMAND, null);
  });

  const runCopy = createCallback(() => {
    const currentEditor = editor();
    if (!currentEditor) return;
    const data = currentEditor.read(() => {
      const selection = $getSelection();
      return $isTableSelection(selection)
        ? $getClipboardDataFromSelection(selection)
        : null;
    });
    if (!data) return;
    void copyToClipboard(currentEditor, null, data).then((copied) => {
      if (copied) toast.success('Copied cells');
    });
  });

  const runClear = createCallback(() => {
    editor()?.update(() => {
      const selection = $getSelection();
      if ($isTableSelection(selection)) $clearSelectedCells(selection);
    });
  });

  // Replays the system clipboard through the normal paste pipeline, so
  // copied cell ranges overlay the grid exactly like a desktop paste.
  const runPaste = createCallback(async () => {
    const currentEditor = editor();
    if (!currentEditor) return;
    const dataTransfer = await readClipboardAsDataTransfer();
    if (!dataTransfer) {
      toast.failure('Nothing to paste');
      return;
    }
    currentEditor.dispatchCommand(
      PASTE_COMMAND,
      new ClipboardEvent('paste', { clipboardData: dataTransfer })
    );
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
              class="z-30 flex items-center gap-0.5 rounded-lg bg-surface p-1 shadow-lg ring-1 ring-edge"
              use:floatWithElement={{
                element: anchorElem,
                floatingOptions: { placement: 'top' },
              }}
            >
              {barButton('Cut', ScissorsIcon, runCut)}
              {barButton('Copy', CopyIcon, runCopy)}
              {barButton('Paste', ClipboardIcon, () => void runPaste())}
              {barButton('Clear', EraserIcon, runClear, true)}
            </div>
          </Layer>
        </ScopedPortal>
      )}
    </Show>
  );
}
