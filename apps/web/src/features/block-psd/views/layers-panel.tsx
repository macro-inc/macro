/**
 * The Layers panel, as in Photoshop: the active layer's blend mode,
 * opacity, fill, and locks at the top; the layers top to bottom (click
 * chooses, ⌘/Ctrl-click adds, Shift-click a range; drag to reorder or into
 * groups; double-click renames; right-click for the layer's menu); and the
 * new layer, group, mask, fill or adjustment, and delete buttons at the
 * bottom.
 */

import { IS_MAC } from '@core/constant/isMac';
import {
  BLEND_MODES,
  type BlendMode,
  type LayerPatch,
  type LayerRow as Row,
} from '@core/psd-engine/types';
import CircleHalf from '@phosphor/circle-half.svg';
import FolderSimplePlus from '@phosphor/folder-simple-plus.svg';
import Plus from '@phosphor/plus.svg';
import SquareHalf from '@phosphor/square-half.svg';
import Trash from '@phosphor/trash.svg';
import { createSignal, For, Show } from 'solid-js';
import {
  CheckField,
  createDragKeys,
  SelectField,
  SliderField,
} from '../components/fields';
import { LayerRow } from '../components/layer-row';
import { MenuButton, type MenuEntry, MenuList } from '../components/menu-bar';
import { ADJUSTMENT_LABELS, ADJUSTMENT_TYPES } from '../core/adjustments';
import {
  type DropZone,
  dropPlacement,
  dropZone,
  rangeBetween,
  visibleRows,
} from '../core/layer-tree';
import { createLayerThumbnails } from '../primitives/create-layer-thumbnails';
import type { PsdCommands } from '../primitives/create-psd-commands';
import type { PsdEditor } from '../primitives/create-psd-editor';

const BLEND_LABELS: Record<BlendMode, string> = {
  passThrough: 'Pass Through',
  normal: 'Normal',
  dissolve: 'Dissolve',
  darken: 'Darken',
  multiply: 'Multiply',
  colorBurn: 'Color Burn',
  linearBurn: 'Linear Burn',
  darkerColor: 'Darker Color',
  lighten: 'Lighten',
  screen: 'Screen',
  colorDodge: 'Color Dodge',
  linearDodge: 'Linear Dodge (Add)',
  lighterColor: 'Lighter Color',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  hardLight: 'Hard Light',
  vividLight: 'Vivid Light',
  linearLight: 'Linear Light',
  pinLight: 'Pin Light',
  hardMix: 'Hard Mix',
  difference: 'Difference',
  exclusion: 'Exclusion',
  subtract: 'Subtract',
  divide: 'Divide',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/** Where a dragged row is over the list. */
interface DropState {
  over: number;
  zone: DropZone;
}

const DRAG_TYPE = 'application/x-macro-psd-layers';

export function LayersPanel(props: {
  editor: PsdEditor;
  commands: PsdCommands;
}) {
  const { editor, commands } = props;
  const thumbnails = createLayerThumbnails({
    engine: editor.engine,
    version: editor.thumbVersion,
  });
  const keys = createDragKeys('layer');
  const [drop, setDrop] = createSignal<DropState>();
  const [menu, setMenu] = createSignal<{ x: number; y: number }>();
  let dragged: number[] = [];

  const rows = () => visibleRows(editor.layers());
  const active = () => editor.activeRow();
  const editable = () => editor.enabled();

  const setLayer = (patch: LayerPatch, key?: string) => {
    const ids = editor.selected();
    if (ids.length > 0) void editor.apply([patchOp(ids, patch)], key);
  };

  const choose = (row: Row, e: MouseEvent) => {
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const current = editor.selected();
    if (mod) {
      const next = current.includes(row.id)
        ? current.filter((id) => id !== row.id)
        : [row.id, ...current];
      editor.chooseLayers(next.length > 0 ? next : [row.id]);
    } else if (e.shiftKey && current[0] !== undefined)
      editor.chooseLayers([
        current[0],
        ...rangeBetween(rows(), current[0], row.id).filter(
          (id) => id !== current[0]
        ),
      ]);
    else editor.chooseLayers([row.id]);
  };

  const onDragOver = (e: DragEvent, row: Row) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const zone = dropZone(row, (e.clientY - r.top) / r.height);
    const placement = dropPlacement(editor.layers(), dragged, row, zone);
    e.dataTransfer.dropEffect = placement ? 'move' : 'none';
    setDrop(placement ? { over: row.id, zone } : undefined);
  };

  const onDrop = (e: DragEvent, row: Row) => {
    const state = drop();
    setDrop(undefined);
    if (!state || state.over !== row.id) return;
    e.preventDefault();
    const placement = dropPlacement(editor.layers(), dragged, row, state.zone);
    if (placement)
      void editor.apply([{ op: 'move', ids: dragged, ...placement }]);
  };

  const layerMenu = (): MenuEntry[] => {
    const row = active();
    const r = commands.run;
    const can = commands.available;
    return [
      {
        label: 'Duplicate Layer',
        onSelect: r.duplicate,
        testId: 'psd-layer-menu-duplicate',
      },
      {
        label: 'Delete Layer',
        onSelect: r.deleteLayers,
        testId: 'psd-layer-menu-delete',
      },
      'divider',
      {
        label: 'Group Layers',
        shortcut: IS_MAC ? '⌘G' : 'Ctrl+G',
        onSelect: r.group,
      },
      { label: 'Ungroup Layers', disabled: !can.group(), onSelect: r.ungroup },
      'divider',
      {
        label: row?.clipping ? 'Release Clipping Mask' : 'Create Clipping Mask',
        disabled: !row || row.background,
        onSelect: r.clippingMask,
        testId: 'psd-layer-menu-clipping',
      },
      {
        label: 'Layer Mask',
        disabled: !row || row.background,
        items: row?.hasMask
          ? [
              {
                label: row.maskDisabled ? 'Enable' : 'Disable',
                onSelect: r.toggleMask,
              },
              { label: 'Apply', onSelect: () => r.deleteMask(true) },
              {
                label: 'Delete',
                onSelect: () => r.deleteMask(false),
                testId: 'psd-layer-menu-delete-mask',
              },
            ]
          : [
              {
                label: 'Reveal All',
                onSelect: () => r.addMask('revealAll'),
                testId: 'psd-layer-menu-mask-reveal',
              },
              { label: 'Hide All', onSelect: () => r.addMask('hideAll') },
              {
                label: 'Reveal Selection',
                disabled: !can.selection(),
                onSelect: () => r.addMask('revealSelection'),
              },
              {
                label: 'Hide Selection',
                disabled: !can.selection(),
                onSelect: () => r.addMask('hideSelection'),
              },
              {
                label: 'From Transparency',
                onSelect: () => r.addMask('transparency'),
              },
            ],
      },
      { label: 'Select Pixels', onSelect: r.loadTransparency },
      'divider',
      {
        label: 'Rasterize Layer',
        disabled: !row || row.kind === 'pixel' || row.kind === 'group',
        onSelect: r.rasterize,
        testId: 'psd-layer-menu-rasterize',
      },
      {
        label: 'Merge Down',
        shortcut: IS_MAC ? '⌘E' : 'Ctrl+E',
        disabled: !can.mergeDown(),
        onSelect: r.mergeDown,
        testId: 'psd-layer-menu-merge-down',
      },
      { label: 'Export as PNG…', onSelect: r.exportLayer },
    ];
  };

  const newMenu = (): MenuEntry[] => [
    {
      label: 'Solid Color…',
      onSelect: () => void commands.run.newFill('solid'),
      testId: 'psd-new-fill-solid',
    },
    {
      label: 'Gradient…',
      onSelect: () => void commands.run.newFill('gradient'),
    },
    'divider',
    ...ADJUSTMENT_TYPES.map((type) => ({
      label: ADJUSTMENT_LABELS[type],
      testId: `psd-new-adjustment-${type}`,
      onSelect: () => void commands.run.newAdjustment(type),
    })),
  ];

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-testid="psd-layers-panel">
      <div class="flex flex-col gap-1.5 border-edge-muted border-b px-3 py-2">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-ink text-xs">Layers</h3>
          <MenuButton
            label="Layer menu"
            testId="psd-layer-menu"
            items={layerMenu()}
            disabled={!editable() || !active()}
          >
            <span class="font-bold text-sm leading-none">⋯</span>
          </MenuButton>
        </div>
        <Show when={active()}>
          {(row) => (
            <>
              <SelectField
                value={row().blend}
                options={BLEND_MODES.filter(
                  (m) => m !== 'passThrough' || row().kind === 'group'
                ).map((m) => ({ value: m, label: BLEND_LABELS[m] }))}
                disabled={!editable()}
                testId="psd-blend-mode"
                onChange={(blend) => setLayer({ blend })}
              />
              <SliderField
                label="Opacity"
                value={Math.round((row().opacity / 255) * 100)}
                min={0}
                max={100}
                unit="%"
                disabled={!editable()}
                testId="psd-layer-opacity"
                onChange={(v, done) => {
                  setLayer(
                    { opacity: Math.round((v / 100) * 255) },
                    keys.key('opacity')
                  );
                  if (done) keys.end();
                }}
              />
              <SliderField
                label="Fill"
                value={Math.round((row().fillOpacity / 255) * 100)}
                min={0}
                max={100}
                unit="%"
                disabled={!editable()}
                testId="psd-layer-fill"
                onChange={(v, done) => {
                  setLayer(
                    { fillOpacity: Math.round((v / 100) * 255) },
                    keys.key('fill')
                  );
                  if (done) keys.end();
                }}
              />
              <div class="flex items-center gap-3">
                <span class="text-ink-muted text-xs">Lock</span>
                <CheckField
                  label="Pixels"
                  checked={row().locks.pixels}
                  disabled={!editable()}
                  testId="psd-lock-pixels"
                  onChange={(pixels) =>
                    setLayer({ locks: { ...row().locks, pixels } })
                  }
                />
                <CheckField
                  label="Alpha"
                  checked={row().locks.transparency}
                  disabled={!editable()}
                  testId="psd-lock-transparency"
                  onChange={(transparency) =>
                    setLayer({ locks: { ...row().locks, transparency } })
                  }
                />
                <CheckField
                  label="Move"
                  checked={row().locks.position}
                  disabled={!editable()}
                  testId="psd-lock-position"
                  onChange={(position) =>
                    setLayer({ locks: { ...row().locks, position } })
                  }
                />
              </div>
            </>
          )}
        </Show>
      </div>
      <div
        role="tree"
        aria-label="Layers"
        class="min-h-0 flex-1 overflow-y-auto"
        data-testid="psd-layer-list"
        onDragLeave={(e) => {
          if (
            !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)
          )
            setDrop(undefined);
        }}
      >
        <For each={rows()}>
          {(row) => (
            <div
              onDragOver={(e) => onDragOver(e, row)}
              onDrop={(e) => onDrop(e, row)}
            >
              <LayerRow
                row={row}
                selected={editor.selected().includes(row.id)}
                maskTarget={
                  editor.target() === 'mask' && editor.active() === row.id
                }
                thumbnail={
                  row.kind === 'group' || row.kind === 'adjustment'
                    ? null
                    : thumbnails.url(row.id)
                }
                editable={editable()}
                dropZone={drop()?.over === row.id ? drop()?.zone : undefined}
                onChoose={(e) => choose(row, e)}
                onChooseMask={() => editor.chooseLayers([row.id], 'mask')}
                onToggleVisible={() =>
                  void editor.apply([
                    patchOp([row.id], { visible: !row.visible }),
                  ])
                }
                onToggleOpen={() =>
                  void editor.apply([patchOp([row.id], { open: !row.open })])
                }
                onToggleEffects={() => void toggleEffects(row.id)}
                onRename={(name) =>
                  void editor.apply([patchOp([row.id], { name })])
                }
                onContextMenu={(e) => {
                  if (!editor.selected().includes(row.id))
                    editor.chooseLayers([row.id]);
                  setMenu({ x: e.clientX, y: e.clientY });
                }}
                onDragStart={(e) => {
                  dragged = editor.selected().includes(row.id)
                    ? editor.selected()
                    : [row.id];
                  e.dataTransfer?.setData(DRAG_TYPE, dragged.join(','));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
              />
            </div>
          )}
        </For>
      </div>
      <Show when={editable()}>
        <div class="flex items-center justify-end gap-0.5 border-edge-muted border-t px-2 py-1">
          <MenuButton
            label="New fill or adjustment layer"
            testId="psd-new-adjustment"
            items={newMenu()}
            up
          >
            <CircleHalf class="size-4" />
          </MenuButton>
          <button
            type="button"
            aria-label="Add a layer mask"
            title="Add a layer mask"
            data-testid="psd-add-mask"
            disabled={!active() || active()?.background || active()?.hasMask}
            class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-40"
            onClick={() =>
              commands.run.addMask(
                editor.hasSelection() ? 'revealSelection' : 'revealAll'
              )
            }
          >
            <SquareHalf class="size-4" />
          </button>
          <button
            type="button"
            aria-label="New group"
            title="New group"
            data-testid="psd-new-group"
            class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
            onClick={commands.run.newGroup}
          >
            <FolderSimplePlus class="size-4" />
          </button>
          <button
            type="button"
            aria-label="New layer"
            title={`New layer · ${IS_MAC ? '⇧⌘N' : 'Ctrl+⇧N'}`}
            data-testid="psd-new-layer"
            class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
            onClick={commands.run.newLayer}
          >
            <Plus class="size-4" />
          </button>
          <button
            type="button"
            aria-label="Delete layer"
            title="Delete layer"
            data-testid="psd-delete-layer"
            disabled={!active()}
            class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-40"
            onClick={commands.run.deleteLayers}
          >
            <Trash class="size-4" />
          </button>
        </div>
      </Show>
      <Show when={menu()}>
        {(at) => (
          <ContextMenu
            at={at()}
            items={layerMenu()}
            onClose={() => setMenu(undefined)}
          />
        )}
      </Show>
    </div>
  );

  async function toggleEffects(id: number) {
    const info = await editor.engine.layerInfo(id);
    if (!info?.effects) return;
    await editor.apply([
      {
        op: 'setEffects',
        id,
        effects: { ...info.effects, enabled: !info.effects.enabled },
      },
    ]);
  }
}

function patchOp(ids: number[], patch: LayerPatch) {
  return { op: 'setLayer' as const, ids, ...patch };
}

/** The layer menu at the pointer (right-click on a row). */
function ContextMenu(props: {
  at: { x: number; y: number };
  items: MenuEntry[];
  onClose: () => void;
}) {
  return (
    <div
      class="fixed inset-0 z-50"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <div
        class="absolute"
        style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}
        data-testid="psd-layer-context-menu"
      >
        <MenuList items={props.items} onDone={props.onClose} />
      </div>
    </div>
  );
}
