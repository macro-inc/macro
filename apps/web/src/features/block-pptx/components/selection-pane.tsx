/**
 * The Selection Pane (Home ▸ Arrange ▸ Selection Pane, Alt+F10): every
 * object on the slide, topmost first, with groups nested. Click selects
 * (Cmd/Ctrl adds), the eye hides or shows, double-click or F2 renames, and
 * dragging or the arrows reorder.
 */

import type { ShapeOutline, SlideOutline } from '@core/pptx-engine/types';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, Show } from 'solid-js';

/** Where a shape sits: its siblings (bottom first) and its index among them. */
export function siblingsOf(
  shapes: ShapeOutline[],
  id: number
): { siblings: ShapeOutline[]; index: number } | undefined {
  const index = shapes.findIndex((s) => s.id === id);
  if (index >= 0) return { siblings: shapes, index };
  for (const s of shapes) {
    const inner = s.children && siblingsOf(s.children, id);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * How many steps toward the front (negative: back) moving sibling `from`
 * takes to land just in front of sibling `to`, or just behind it when
 * `behind` (dropped below it in the front-first list).
 */
export function dropSteps(from: number, to: number, behind: boolean): number {
  // `to`'s index once the moved shape is out of the list.
  const target = from < to ? to - 1 : to;
  return (behind ? target : target + 1) - from;
}

export function SelectionPane(props: {
  slide: SlideOutline;
  selectedIds: number[];
  readonly: boolean;
  /** `toggle` adds or removes the shape (Cmd/Ctrl+click). */
  onSelect: (id: number, toggle: boolean) => void;
  onRename: (id: number, name: string) => void;
  onHide: (ids: number[], hidden: boolean) => void;
  /** Moves a shape among its siblings: +1 is one step toward the front. */
  onMove: (id: number, steps: number) => void;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = createSignal<number[]>([]);
  const [renaming, setRenaming] = createSignal<number>();
  const [dragging, setDragging] = createSignal<number>();
  const [dropAt, setDropAt] = createSignal<{ id: number; after: boolean }>();
  const ro = () => props.readonly;
  const selected = (id: number) => props.selectedIds.includes(id);
  const allIds = (list: ShapeOutline[]): number[] =>
    list.flatMap((s) => [s.id, ...allIds(s.children ?? [])]);
  const single = () =>
    props.selectedIds.length === 1 ? props.selectedIds[0] : undefined;
  const position = () => {
    const id = single();
    return id === undefined ? undefined : siblingsOf(props.slide.shapes, id);
  };

  /** Drops the dragged row before or after (in list order) row `target`. */
  const drop = (target: number, after: boolean) => {
    const id = dragging();
    setDragging(undefined);
    setDropAt(undefined);
    if (id === undefined || id === target) return;
    const from = siblingsOf(props.slide.shapes, id);
    const to = siblingsOf(props.slide.shapes, target);
    // Only among siblings, as PowerPoint reorders within a group.
    if (!from || !to || from.siblings !== to.siblings) return;
    const steps = dropSteps(from.index, to.index, after);
    if (steps !== 0) props.onMove(id, steps);
  };

  const Row = (rowProps: { shape: ShapeOutline; depth: number }) => {
    const s = () => rowProps.shape;
    const isGroup = () => (s().children?.length ?? 0) > 0;
    const open = () => !collapsed().includes(s().id);
    let input: HTMLInputElement | undefined;
    const commit = () => {
      const name = input?.value.trim();
      setRenaming(undefined);
      if (name && name !== s().name) props.onRename(s().id, name);
    };
    return (
      <>
        <div
          role="treeitem"
          tabIndex={-1}
          aria-selected={selected(s().id)}
          aria-expanded={isGroup() ? open() : undefined}
          data-testid="pptx-selection-row"
          data-shape-id={s().id}
          draggable={!ro() && renaming() !== s().id}
          class="group flex h-7 items-center gap-1 rounded-md pr-1 text-xs hover:bg-ink/5"
          classList={{
            'bg-accent-bg': selected(s().id),
            'opacity-50': dragging() === s().id,
            'border-t-2 border-accent':
              dropAt()?.id === s().id && !dropAt()?.after,
            'border-b-2 border-accent':
              dropAt()?.id === s().id && !!dropAt()?.after,
          }}
          style={{ 'padding-left': `${4 + rowProps.depth * 14}px` }}
          onClick={(e) => props.onSelect(s().id, e.metaKey || e.ctrlKey)}
          onDblClick={() => !ro() && setRenaming(s().id)}
          onKeyDown={(e) => {
            if (e.key === 'F2' && !ro()) setRenaming(s().id);
          }}
          onDragStart={(e) => {
            setDragging(s().id);
            e.dataTransfer?.setData('text/plain', String(s().id));
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => {
            setDragging(undefined);
            setDropAt(undefined);
          }}
          onDragOver={(e) => {
            if (dragging() === undefined) return;
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            setDropAt({
              id: s().id,
              after: e.clientY > box.top + box.height / 2,
            });
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(s().id, dropAt()?.after ?? false);
          }}
        >
          <span class="flex w-4 shrink-0 justify-center text-ink-muted">
            <Show when={isGroup()}>
              <button
                type="button"
                class="rounded p-0.5 hover:text-ink"
                aria-label={open() ? 'Collapse group' : 'Expand group'}
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed((c) =>
                    open() ? [...c, s().id] : c.filter((x) => x !== s().id)
                  );
                }}
              >
                <Show when={open()} fallback={<CaretRight class="size-3" />}>
                  <CaretDown class="size-3" />
                </Show>
              </button>
            </Show>
          </span>
          <Show
            when={renaming() === s().id}
            fallback={
              <span
                class="min-w-0 flex-1 truncate text-ink"
                classList={{ 'text-ink-muted italic': s().hidden }}
                title={s().name}
              >
                {s().name}
              </span>
            }
          >
            <input
              ref={(el) => {
                input = el;
                queueMicrotask(() => {
                  el.focus();
                  el.select();
                });
              }}
              class="h-6 min-w-0 flex-1 rounded border border-accent bg-input px-1 text-ink text-xs outline-none"
              value={s().name}
              aria-label="Shape name"
              data-testid="pptx-selection-rename"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit();
                else if (e.key === 'Escape') setRenaming(undefined);
              }}
              onBlur={commit}
            />
          </Show>
          <button
            type="button"
            class="shrink-0 rounded p-1 text-ink-muted hover:text-ink disabled:opacity-50"
            classList={{ 'opacity-0 group-hover:opacity-100': !s().hidden }}
            aria-label={s().hidden ? 'Show' : 'Hide'}
            aria-pressed={s().hidden}
            data-testid="pptx-selection-eye"
            disabled={ro()}
            onClick={(e) => {
              e.stopPropagation();
              props.onHide([s().id], !s().hidden);
            }}
          >
            <Show when={s().hidden} fallback={<Eye class="size-3.5" />}>
              <EyeSlash class="size-3.5" />
            </Show>
          </button>
        </div>
        <Show when={isGroup() && open()}>
          <For each={[...(s().children ?? [])].reverse()}>
            {(child) => <Row shape={child} depth={rowProps.depth + 1} />}
          </For>
        </Show>
      </>
    );
  };

  return (
    <aside
      class="flex w-64 shrink-0 flex-col border-edge-muted border-l bg-panel"
      data-testid="pptx-selection-pane"
      aria-label="Selection pane"
    >
      <div class="flex h-9 items-center justify-between border-edge-muted border-b px-3">
        <span class="font-semibold text-ink text-sm">Selection</span>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <div class="flex items-center gap-1 border-edge-muted border-b px-2 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          data-testid="pptx-selection-show-all"
          disabled={ro()}
          onClick={() => props.onHide(allIds(props.slide.shapes), false)}
        >
          Show All
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="pptx-selection-hide-all"
          disabled={ro()}
          onClick={() => props.onHide(allIds(props.slide.shapes), true)}
        >
          Hide All
        </Button>
        <div class="flex-1" />
        <Button
          size="icon-sm"
          variant="ghost"
          label="Bring forward"
          tooltip="Bring Forward"
          data-testid="pptx-selection-forward"
          disabled={
            ro() ||
            !position() ||
            position()!.index >= position()!.siblings.length - 1
          }
          onClick={() => {
            const id = single();
            if (id !== undefined) props.onMove(id, 1);
          }}
        >
          <ArrowUp />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Send backward"
          tooltip="Send Backward"
          data-testid="pptx-selection-backward"
          disabled={ro() || !position() || position()!.index === 0}
          onClick={() => {
            const id = single();
            if (id !== undefined) props.onMove(id, -1);
          }}
        >
          <ArrowDown />
        </Button>
      </div>
      <div
        class="min-h-0 flex-1 overflow-y-auto p-1"
        role="tree"
        aria-label="Objects on this slide"
      >
        <Show
          when={props.slide.shapes.length > 0}
          fallback={
            <p class="p-3 text-ink-muted text-xs">This slide has no objects.</p>
          }
        >
          <For each={[...props.slide.shapes].reverse()}>
            {(shape) => <Row shape={shape} depth={0} />}
          </For>
        </Show>
      </div>
    </aside>
  );
}
