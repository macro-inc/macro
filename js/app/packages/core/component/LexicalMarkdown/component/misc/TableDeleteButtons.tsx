import { mdStore } from '@block-md/signal/markdownBlockData';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  getDOMCellFromTarget,
} from '@lexical/table';
import TrashIcon from '@phosphor/trash-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { $getNearestNodeFromDOMNode, isHTMLElement } from 'lexical';
import { createSignal, onCleanup, Show } from 'solid-js';

type DeleteTarget = {
  cellElem: HTMLElement;
  cellLeft: number;
  cellRight: number;
  cellTop: number;
  cellBottom: number;
  tableTop: number;
  tableBottom: number;
  // Clamped to the visible span of the scroll wrapper.
  tableLeft: number;
  tableRight: number;
};

const BUTTON_CLASS =
  'fixed z-20 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-edge bg-surface text-ink-muted shadow-sm hover:border-failure hover:bg-failure hover:text-surface';

export function TableDeleteButtons() {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [target, setTarget] = createSignal<DeleteTarget>();
  const [hovered, setHovered] = createSignal<'row' | 'column' | 'table'>();

  const clear = () => {
    if (!hovered()) setTarget(undefined);
  };

  const onPointerMove = createCallback((event: PointerEvent) => {
    const eventTarget = event.target;
    if (!editor() || !isHTMLElement(eventTarget)) return;

    const domCell = getDOMCellFromTarget(eventTarget);
    if (!domCell) return clear();

    const tableElem = domCell.elem.closest('table');
    if (!tableElem) return clear();

    const rect = domCell.elem.getBoundingClientRect();
    const tableRect = tableElem.getBoundingClientRect();
    const wrapperRect = tableElem
      .closest('.md-table-scrollable-wrapper')
      ?.getBoundingClientRect();

    setTarget({
      cellElem: domCell.elem,
      cellLeft: rect.left,
      cellRight: rect.right,
      cellTop: rect.top,
      cellBottom: rect.bottom,
      tableTop: tableRect.top,
      tableBottom: tableRect.bottom,
      tableLeft: Math.max(tableRect.left, wrapperRect?.left ?? -Infinity),
      tableRight: Math.min(tableRect.right, wrapperRect?.right ?? Infinity),
    });
  });

  const deleteAt = createCallback((type: 'row' | 'column' | 'table') => {
    const currentTarget = target();
    const currentEditor = editor();
    if (!currentTarget || !currentEditor) return;

    currentEditor.update(() => {
      const cellNode = $getNearestNodeFromDOMNode(currentTarget.cellElem);
      if (!$isTableCellNode(cellNode) || !cellNode.isAttached()) return;

      if (type === 'table') {
        $getTableNodeFromLexicalNodeOrThrow(cellNode).remove();
        return;
      }

      // The delete helpers operate on the selection, so anchor it in the
      // hovered cell.
      cellNode.selectStart();
      if (type === 'row') $deleteTableRowAtSelection();
      else $deleteTableColumnAtSelection();
    });

    setHovered(undefined);
    setTarget(undefined);
  });

  const removeRootListener = editor()?.registerRootListener(
    (rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener('pointermove', onPointerMove);
      rootElement?.addEventListener('pointermove', onPointerMove);
    }
  );

  // Positions go stale on any scroll; just hide.
  const onScroll = () => setTarget(undefined);
  document.addEventListener('scroll', onScroll, {
    capture: true,
    passive: true,
  });

  onCleanup(() => {
    removeRootListener?.();
    document.removeEventListener('scroll', onScroll, { capture: true });
  });

  const onButtonLeave = () => {
    setHovered(undefined);
    setTarget(undefined);
  };

  return (
    <Show when={target()}>
      {(t) => (
        <ScopedPortal scope="split">
          {/* Highlight of the row/column about to be deleted. */}
          <Show when={hovered()}>
            {(h) => (
              <div
                class="fixed z-10 pointer-events-none bg-failure/15"
                style={{
                  left:
                    h() === 'column' ? `${t().cellLeft}px` : `${t().tableLeft}px`,
                  width:
                    h() === 'column'
                      ? `${t().cellRight - t().cellLeft}px`
                      : `${t().tableRight - t().tableLeft}px`,
                  top: h() === 'row' ? `${t().cellTop}px` : `${t().tableTop}px`,
                  height:
                    h() === 'row'
                      ? `${t().cellBottom - t().cellTop}px`
                      : `${t().tableBottom - t().tableTop}px`,
                }}
              />
            )}
          </Show>
          <button
            type="button"
            aria-label="Delete column"
            class={BUTTON_CLASS}
            style={{
              left: `${(t().cellLeft + t().cellRight) / 2}px`,
              top: `${Math.max(t().tableTop, 12)}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onPointerEnter={() => setHovered('column')}
            onPointerLeave={onButtonLeave}
            onClick={() => deleteAt('column')}
          >
            <TrashIcon class="size-3" />
          </button>
          <button
            type="button"
            aria-label="Delete row"
            class={BUTTON_CLASS}
            style={{
              left: `${t().tableLeft}px`,
              top: `${(t().cellTop + t().cellBottom) / 2}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onPointerEnter={() => setHovered('row')}
            onPointerLeave={onButtonLeave}
            onClick={() => deleteAt('row')}
          >
            <TrashIcon class="size-3" />
          </button>
          <button
            type="button"
            aria-label="Delete table"
            class={BUTTON_CLASS}
            style={{
              left: `${t().tableLeft}px`,
              top: `${t().tableTop}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
            onPointerEnter={() => setHovered('table')}
            onPointerLeave={onButtonLeave}
            onClick={() => deleteAt('table')}
          >
            <TrashIcon class="size-3" />
          </button>
        </ScopedPortal>
      )}
    </Show>
  );
}
