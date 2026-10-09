/**
 * One row of the layers panel, as Photoshop draws it: visibility, the
 * layer's thumbnail (or its kind for groups, artboards, and adjustment
 * layers), the mask's thumbnail when it has one, the name (double-click
 * renames), and
 * markers for clipping, locks, and the layer style (fx turns it on or
 * off). Presentational.
 */

import type { LayerRow as Row } from '@core/psd-engine/types';
import ArrowBendDownRight from '@phosphor/arrow-bend-down-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CircleHalf from '@phosphor/circle-half.svg';
import Drop from '@phosphor/drop-half.svg';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import FolderSimple from '@phosphor/folder-simple.svg';
import FrameCorners from '@phosphor/frame-corners.svg';
import LockSimple from '@phosphor/lock-simple.svg';
import Shapes from '@phosphor/shapes.svg';
import Stack from '@phosphor/stack.svg';
import TextT from '@phosphor/text-t.svg';
import { createSignal, Match, Show, Switch } from 'solid-js';

/** Transparency, as Photoshop's checkerboard (literal colors: it is data). */
const CHECKERBOARD =
  'repeating-conic-gradient(#cccccc 0 25%, #ffffff 0 50%) 50% / 8px 8px';

export function LayerRow(props: {
  row: Row;
  /** Chosen in the panel. */
  selected: boolean;
  /** The active layer's edits go to its mask. */
  maskTarget: boolean;
  thumbnail?: string | null;
  /** The mask's thumbnail (`null` while there is none to show). */
  maskThumbnail?: string | null;
  editable: boolean;
  /** Where a dragged row would land: above, inside, or below this one. */
  dropZone?: 'before' | 'inside' | 'after';
  onChoose: (e: MouseEvent) => void;
  onChooseMask: () => void;
  onToggleVisible: () => void;
  onToggleOpen: () => void;
  onToggleEffects: () => void;
  onRename: (name: string) => void;
  onContextMenu: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
}) {
  const [renaming, setRenaming] = createSignal(false);
  const locked = () =>
    props.row.locks.pixels ||
    props.row.locks.position ||
    props.row.locks.transparency;
  return (
    <div
      role="treeitem"
      aria-selected={props.selected}
      aria-level={props.row.depth + 1}
      data-testid="psd-layer-row"
      data-layer-id={props.row.id}
      data-layer-name={props.row.name}
      draggable={props.editable && !props.row.background && !renaming()}
      class="relative flex h-10 select-none items-center gap-1.5 border-edge-muted border-b pr-2 text-xs"
      classList={{
        'bg-accent/15 text-ink': props.selected,
        'text-ink hover:bg-hover': !props.selected,
        'opacity-60': !props.row.shown && props.row.visible,
      }}
      style={{ 'padding-left': `${6 + props.row.depth * 14}px` }}
      onClick={(e) => props.onChoose(e)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu(e);
      }}
      onDragStart={(e) => props.onDragStart(e)}
      onDblClick={() => {
        if (props.editable) setRenaming(true);
      }}
    >
      <Show when={props.dropZone}>
        {(zone) => (
          <span
            class="pointer-events-none absolute inset-x-0 z-10"
            classList={{
              'top-0 h-0.5 bg-accent': zone() === 'before',
              'bottom-0 h-0.5 bg-accent': zone() === 'after',
              'inset-y-0 border-2 border-accent': zone() === 'inside',
            }}
          />
        )}
      </Show>
      <button
        type="button"
        aria-label={props.row.visible ? 'Hide layer' : 'Show layer'}
        title={props.row.visible ? 'Hide' : 'Show'}
        data-testid="psd-layer-visibility"
        class="flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:text-ink"
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleVisible();
        }}
      >
        <Show
          when={props.row.visible}
          fallback={<EyeSlash class="size-3.5 opacity-60" />}
        >
          <Eye class="size-3.5" />
        </Show>
      </button>
      <Show when={props.row.clipping}>
        <ArrowBendDownRight
          class="size-3 shrink-0 text-ink-muted"
          aria-label="Clipped"
        />
      </Show>
      <Show when={props.row.kind === 'group'}>
        <button
          type="button"
          aria-label={props.row.open ? 'Collapse group' : 'Expand group'}
          data-testid="psd-layer-disclosure"
          class="flex size-4 shrink-0 items-center justify-center text-ink-muted hover:text-ink"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleOpen();
          }}
        >
          <Show when={props.row.open} fallback={<CaretRight class="size-3" />}>
            <CaretDown class="size-3" />
          </Show>
        </button>
      </Show>
      <span
        class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-inset"
        classList={{
          'border-accent': props.selected && !props.maskTarget,
          'border-edge-muted': !(props.selected && !props.maskTarget),
        }}
        data-testid="psd-layer-thumbnail"
      >
        <Switch
          fallback={
            <Show when={props.thumbnail}>
              {(src) => (
                <img
                  src={src()}
                  alt=""
                  class="max-h-full max-w-full object-contain"
                  style={{ background: CHECKERBOARD }}
                  draggable={false}
                />
              )}
            </Show>
          }
        >
          <Match when={props.row.artboard}>
            <span title="Artboard" data-testid="psd-layer-artboard">
              <FrameCorners class="size-4 text-ink-muted" />
            </span>
          </Match>
          <Match when={props.row.kind === 'group'}>
            <FolderSimple class="size-4 text-ink-muted" />
          </Match>
          <Match when={props.row.kind === 'text'}>
            <TextT class="size-5 text-ink" />
          </Match>
          <Match when={props.row.kind === 'adjustment'}>
            <CircleHalf class="size-4 text-ink-muted" />
          </Match>
          <Match when={props.row.kind === 'fill' && !props.thumbnail}>
            <Drop class="size-4 text-ink-muted" />
          </Match>
          <Match when={props.thumbnail === null}>
            {/* A layer with no pixels yet: all transparent. */}
            <span class="size-full" style={{ background: CHECKERBOARD }} />
          </Match>
        </Switch>
      </span>
      <Show when={props.row.hasMask}>
        <button
          type="button"
          aria-label="Edit the layer mask"
          title={props.row.maskDisabled ? 'Layer mask (off)' : 'Layer mask'}
          data-testid="psd-layer-mask"
          class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-surface"
          classList={{
            'border-accent': props.selected && props.maskTarget,
            'border-edge-muted': !(props.selected && props.maskTarget),
            'opacity-50': props.row.maskDisabled,
          }}
          onClick={(e) => {
            e.stopPropagation();
            props.onChooseMask();
          }}
        >
          <Show
            when={props.maskThumbnail}
            fallback={
              <span class="size-4 rounded-full border border-edge bg-ink/70" />
            }
          >
            {(src) => (
              <img
                src={src()}
                alt=""
                class="max-h-full max-w-full object-contain"
                draggable={false}
                data-testid="psd-layer-mask-thumbnail"
              />
            )}
          </Show>
        </button>
      </Show>
      <Show
        when={renaming()}
        fallback={
          <span class="min-w-0 flex-1 truncate" title={props.row.name}>
            <Show when={props.row.kind === 'shape'}>
              <Shapes class="mr-1 inline size-3 text-ink-muted" />
            </Show>
            <Show when={props.row.kind === 'smartObject'}>
              <Stack class="mr-1 inline size-3 text-ink-muted" />
            </Show>
            <span classList={{ italic: props.row.background }}>
              {props.row.name}
            </span>
          </span>
        }
      >
        <input
          class="min-w-0 flex-1 rounded border border-edge-focus bg-input px-1 text-ink outline-none"
          value={props.row.name}
          data-testid="psd-layer-rename"
          ref={(el) => queueMicrotask(() => el.select())}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = props.row.name;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim();
            setRenaming(false);
            if (name && name !== props.row.name) props.onRename(name);
          }}
        />
      </Show>
      <Show when={props.row.hasEffects}>
        <button
          type="button"
          title="Turn the layer style off or on"
          data-testid="psd-layer-effects"
          class="shrink-0 rounded px-1 font-semibold text-[10px] text-ink-muted italic hover:bg-hover hover:text-ink"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleEffects();
          }}
        >
          fx
        </button>
      </Show>
      <Show when={locked() || props.row.background}>
        <LockSimple
          class="size-3 shrink-0 text-ink-muted"
          aria-label="Locked"
        />
      </Show>
    </div>
  );
}
