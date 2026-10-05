/**
 * The Layers panel: the layer tree, top to bottom as Illustrator lists it,
 * with visibility and lock toggles, expanding and collapsing, selection
 * that follows the canvas (⇧-click a range, ⌘/Ctrl-click to toggle),
 * renaming by double-click, dragging rows to restack or move them into
 * other groups and layers, the layer's color, and new and deleted layers.
 */

import { IS_MAC } from '@core/constant/isMac';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import { Button } from '@ui/components/Button';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import { VList, type VListHandle } from 'virtua/solid';
import { LayerRowView, ROW_HEIGHT } from '../components/layer-row';
import {
  ancestorsOf,
  type DropZone,
  dropMove,
  isContainer,
  rangeIds,
  visibleRows,
} from '../core/layers';
import type { AiEditor } from '../primitives/create-ai-editor';
import type { AiViewer } from '../primitives/create-ai-viewer';

/** Illustrator's layer colors, in the order new layers take them. */
const LAYER_COLORS: [number, number, number][] = [
  [79, 128, 255],
  [255, 79, 79],
  [79, 255, 79],
  [79, 79, 255],
  [255, 255, 79],
  [255, 79, 255],
  [79, 255, 255],
  [153, 153, 153],
  [0, 102, 0],
  [255, 153, 0],
];

export function LayersPanel(props: { viewer: AiViewer; editor: AiEditor }) {
  const viewer = props.viewer;
  const editor = props.editor;
  const [expanded, setExpanded] = createSignal(new Set<number>());
  /** Layers seen so far: new ones open expanded, as Illustrator shows them. */
  const seen = new Set<number>();
  createEffect(
    on(viewer.rows, (rows) => {
      const fresh = rows.filter((r) => r.depth === 0 && !seen.has(r.id));
      if (fresh.length === 0) return;
      for (const r of fresh) seen.add(r.id);
      setExpanded(
        (current) => new Set([...current, ...fresh.map((r) => r.id)])
      );
    })
  );

  const selectedIds = createMemo(() => new Set(viewer.selected()));
  /** Rows inside a selected group or layer (a lighter tint). */
  const insideSelection = createMemo(() => {
    const selected = selectedIds();
    const inside = new Set<number>();
    for (const r of viewer.rows())
      if (r.parent !== null && (selected.has(r.parent) || inside.has(r.parent)))
        inside.add(r.id);
    return inside;
  });
  // The rows stay the same objects while the selection changes, so the
  // list keeps their elements (a double-click needs both clicks on one).
  const shown = createMemo(() => visibleRows(viewer.rows(), expanded()));

  let list: VListHandle | undefined;
  // Reveal the selection: open its ancestors and scroll to it.
  createEffect(
    on(
      viewer.revealSignal,
      () => {
        const first = viewer.selected()[0];
        if (first === undefined) return;
        const chain = ancestorsOf(viewer.rows(), first);
        if (chain.some((id) => !expanded().has(id)))
          setExpanded((current) => new Set([...current, ...chain]));
        queueMicrotask(() => {
          const at = shown().findIndex((r) => r.id === first);
          if (at >= 0) list?.scrollToIndex(at, { align: 'nearest' });
        });
      },
      { defer: true }
    )
  );

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ---- selection ---------------------------------------------------------

  let anchor: number | undefined;
  const onRowClick = (id: number, e: MouseEvent) => {
    const toggleKey = IS_MAC ? e.metaKey : e.ctrlKey;
    if (e.shiftKey) {
      const from =
        anchor !== undefined && viewer.selected().includes(anchor)
          ? anchor
          : viewer.selected().at(-1);
      if (from !== undefined) {
        viewer.select(
          rangeIds(
            shown().map((r) => r.id),
            from,
            id
          )
        );
        return;
      }
    }
    anchor = id;
    if (toggleKey) viewer.toggle([id]);
    else viewer.select([id]);
  };

  // ---- editing -------------------------------------------------------------

  const [renaming, setRenaming] = createSignal<number>();
  createEffect(
    on(
      viewer.renameSignal,
      () => {
        const first = viewer.selected()[0];
        if (first !== undefined && editor.enabled()) setRenaming(first);
      },
      { defer: true }
    )
  );

  const rename = (id: number, name: string | undefined) => {
    setRenaming(undefined);
    const row = viewer.rowById().get(id);
    const trimmed = name?.trim();
    if (!row || !trimmed || trimmed === row.name) return;
    void editor.setNodes({ name: trimmed }, [id]);
  };

  /** The next color in Illustrator's order. */
  const cycleColor = (id: number) => {
    const current = viewer.rowById().get(id)?.color;
    const at = LAYER_COLORS.findIndex((c) => c.join() === current?.join());
    const next = LAYER_COLORS[(at + 1) % LAYER_COLORS.length];
    void editor.apply([{ op: 'setNode', ids: [id], color: next }]);
  };

  const [dragging, setDragging] = createSignal<number[]>();
  const [drop, setDrop] = createSignal<{ id: number; zone: DropZone }>();

  const zoneFor = (e: DragEvent, container: boolean): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (container && t > 0.3 && t < 0.7) return 'inside';
    return t < 0.5 ? 'above' : 'below';
  };

  const onDrop = (targetId: number) => {
    const ids = dragging();
    const zone = drop()?.zone;
    setDragging(undefined);
    setDrop(undefined);
    const target = viewer.rowById().get(targetId);
    if (!ids || !zone || !target) return;
    const move = dropMove(viewer.rows(), ids, target, zone);
    if (move) void editor.apply([{ op: 'move', ...move }]);
  };

  const deleteSelected = () => void editor.deleteSelection();

  return (
    <div
      class="flex size-full min-h-0 flex-col text-ink text-xs"
      data-testid="ai-layers-panel"
    >
      <div class="flex h-8 shrink-0 items-center gap-1 border-edge-muted border-b px-2">
        <span class="flex-1 text-ink-muted">
          {viewer.rows().filter((r) => r.depth === 0).length} layers
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          label="New layer"
          tooltip="New layer"
          data-testid="ai-layer-new"
          disabled={!editor.enabled()}
          onClick={() => void editor.newLayer()}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Delete selection"
          tooltip="Delete selection"
          data-testid="ai-layer-delete"
          disabled={!editor.enabled() || viewer.selected().length === 0}
          onClick={deleteSelected}
        >
          <Trash />
        </Button>
      </div>
      <div
        aria-label="Layers"
        role="tree"
        data-testid="ai-layer-tree"
        class="relative min-h-0 flex-1"
      >
        <VList
          ref={(h) => {
            list = h;
          }}
          data={shown()}
          itemSize={ROW_HEIGHT}
          class="h-full"
          style={{ height: '100%', width: '100%' }}
        >
          {(row) => {
            const color = () =>
              row.color ? `rgb(${row.color.join(', ')})` : undefined;
            return (
              <LayerRowView
                row={row}
                color={color()}
                selected={selectedIds().has(row.id)}
                inSelection={insideSelection().has(row.id)}
                expanded={expanded().has(row.id)}
                renaming={renaming() === row.id}
                editable={editor.enabled()}
                drop={drop()?.id === row.id ? drop()?.zone : undefined}
                onToggle={() => toggle(row.id)}
                onClick={(e) => onRowClick(row.id, e)}
                onStartRename={() => {
                  if (editor.enabled()) setRenaming(row.id);
                }}
                onRename={(name) => rename(row.id, name)}
                onHidden={() =>
                  void editor.setNodes({ hidden: !row.hidden }, [row.id])
                }
                onLocked={() =>
                  void editor.setNodes({ locked: !row.locked }, [row.id])
                }
                onColor={
                  editor.enabled() ? () => cycleColor(row.id) : undefined
                }
                onHover={(inside) =>
                  void viewer.hoverNode(inside ? row.id : undefined)
                }
                drag={
                  editor.enabled()
                    ? {
                        onStart: (e) => {
                          const ids = selectedIds().has(row.id)
                            ? [...selectedIds()]
                            : [row.id];
                          setDragging(ids);
                          e.dataTransfer?.setData('text/plain', ids.join(','));
                          if (e.dataTransfer)
                            e.dataTransfer.effectAllowed = 'move';
                        },
                        onOver: (e) => {
                          if (!dragging()) return;
                          e.preventDefault();
                          setDrop({
                            id: row.id,
                            zone: zoneFor(e, isContainer(row)),
                          });
                        },
                        onLeave: () => {
                          if (drop()?.id === row.id) setDrop(undefined);
                        },
                        onDrop: () => onDrop(row.id),
                        onEnd: () => {
                          setDragging(undefined);
                          setDrop(undefined);
                        },
                      }
                    : undefined
                }
              />
            );
          }}
        </VList>
      </div>
    </div>
  );
}
