/**
 * The slide list: numbered thumbnails, drag to reorder, and per-slide
 * actions. Shift-click and Cmd/Ctrl-click select several slides, which move,
 * duplicate, hide, and delete together. With `grid` it is the slide sorter.
 */

import { ContextMenuContent } from '@core/component/ContextMenu';
import type { SlideOutline } from '@core/pptx-engine/types';
import { ContextMenu } from '@kobalte/core/context-menu';
import CopyIcon from '@phosphor/copy.svg';
import EyeIcon from '@phosphor/eye.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { PresentationPeer } from '../context/pptx-editor-context';
import { BitmapCanvas } from './bitmap-canvas';
import { SlidePeers } from './peer-presence';

export interface SlideRailProps {
  slides: SlideOutline[];
  current: number;
  /** Ids of the selected slides (the current one among them). */
  selectedIds: number[];
  /** Lays slides out in a grid (the slide sorter) instead of a column. */
  grid?: boolean;
  /** Slide aspect ratio (height / width). */
  aspect: number;
  thumbnail: (slide: SlideOutline) => ImageBitmap | undefined;
  thumbnailPixels: number;
  readonly: boolean;
  onSelect: (index: number, mods: { shift: boolean; toggle: boolean }) => void;
  onSelectAll: () => void;
  /** Moves slides as a block before the slide now at `at`. */
  onMove: (slideIds: number[], at: number) => void;
  /** Double-click (the sorter opens the slide). */
  onOpen?: (index: number) => void;
  onAdd: () => void;
  onDuplicate: (slideId: number) => void;
  onDelete: (slideIds: number[]) => void;
  onToggleHidden: (slide: SlideOutline) => void;
  /** Other people on a slide (collaborative presentations). */
  peersOn?: (slideId: number) => PresentationPeer[];
  /** Right-click menu items for a slide (or the empty rail). */
  menu?: (slide: SlideOutline | undefined) => JSX.Element;
  onCopy?: (event: ClipboardEvent) => void;
  onCut?: (event: ClipboardEvent) => void;
  onPaste?: (event: ClipboardEvent) => void;
  /** Whether keyboard focus is in the rail (clipboard acts on slides then). */
  onFocusChange?: (focused: boolean) => void;
}

export function SlideRail(props: SlideRailProps) {
  let list!: HTMLDivElement;
  const [dragging, setDragging] = createSignal<number[] | null>(null);
  const [menuSlide, setMenuSlide] = createSignal<SlideOutline>();
  const [dropAt, setDropAt] = createSignal<number | null>(null);
  const isSelected = (id: number) => props.selectedIds.includes(id);

  /** Thumbnails per row (1 in the rail). */
  const columns = () => {
    if (!props.grid) return 1;
    const items = [...list.querySelectorAll<HTMLElement>('[data-slide-index]')];
    const top = items[0]?.offsetTop;
    return Math.max(1, items.filter((el) => el.offsetTop === top).length);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step: Record<string, number> = props.grid
      ? {
          ArrowLeft: -1,
          ArrowRight: 1,
          ArrowUp: -columns(),
          ArrowDown: columns(),
        }
      : { ArrowUp: -1, ArrowDown: 1 };
    const mod = event.metaKey || event.ctrlKey;
    if (event.key in step) {
      event.preventDefault();
      const to = Math.min(
        props.slides.length - 1,
        Math.max(0, props.current + step[event.key])
      );
      props.onSelect(to, { shift: event.shiftKey, toggle: false });
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      props.onSelect(event.key === 'Home' ? 0 : props.slides.length - 1, {
        shift: event.shiftKey,
        toggle: false,
      });
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      props.onSelectAll();
    } else if (mod && event.key.toLowerCase() === 'd' && !props.readonly) {
      event.preventDefault();
      const slide = props.slides[props.current];
      if (slide) props.onDuplicate(slide.id);
    } else if (event.key === 'Enter' && props.onOpen) {
      event.preventDefault();
      props.onOpen(props.current);
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      !props.readonly &&
      props.selectedIds.length < props.slides.length
    ) {
      event.preventDefault();
      props.onDelete(props.selectedIds);
    }
  };

  return (
    <nav
      aria-label="Slides"
      data-testid={props.grid ? 'pptx-slide-sorter' : 'pptx-slide-rail'}
      class="flex h-full shrink-0 flex-col bg-panel"
      classList={{
        'w-44 border-edge-muted border-r': !props.grid,
        'min-w-0 flex-1': !!props.grid,
      }}
    >
      <ContextMenu>
        <ContextMenu.Trigger
          as="div"
          ref={list}
          class="min-h-0 flex-1 overflow-y-auto outline-none"
          classList={{
            'flex flex-col gap-2 p-2': !props.grid,
            'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-x-6 gap-y-4 p-6':
              !!props.grid,
          }}
          tabIndex={0}
          data-testid="pptx-slide-list"
          onKeyDown={onKeyDown}
          onCopy={(e: ClipboardEvent) => props.onCopy?.(e)}
          onCut={(e: ClipboardEvent) => props.onCut?.(e)}
          onPaste={(e: ClipboardEvent) => props.onPaste?.(e)}
          onFocusIn={() => props.onFocusChange?.(true)}
          onFocusOut={(e: FocusEvent) => {
            const list = e.currentTarget as HTMLElement | null;
            if (!list?.contains(e.relatedTarget as Node | null))
              props.onFocusChange?.(false);
          }}
          // A right press picks the slide its menu is for (Kobalte's trigger
          // keeps onContextMenu to itself).
          onPointerDown={(e: PointerEvent) => {
            if (e.button !== 2) return;
            const el = (e.target as HTMLElement).closest<HTMLElement>(
              '[data-slide-index]'
            );
            const index = el ? Number(el.dataset.slideIndex) : -1;
            const slide = props.slides[index];
            setMenuSlide(slide);
            // A right press on an unselected slide selects it alone.
            if (slide && !isSelected(slide.id))
              props.onSelect(index, { shift: false, toggle: false });
          }}
        >
          <For each={props.slides}>
            {(slide, i) => (
              <div
                class="group relative flex gap-1.5"
                classList={{ 'flex-col items-stretch': !!props.grid }}
                data-slide-index={i()}
                draggable={!props.readonly}
                onDragStart={(e) => {
                  // Dragging a selected slide moves the whole selection.
                  setDragging(
                    isSelected(slide.id) ? props.selectedIds : [slide.id]
                  );
                  e.dataTransfer?.setData('text/plain', String(slide.id));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (dragging() === null) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const before = props.grid
                    ? e.clientX < rect.left + rect.width / 2
                    : e.clientY < rect.top + rect.height / 2;
                  setDropAt(before ? i() : i() + 1);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropAt(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const ids = dragging();
                  const at = dropAt();
                  setDragging(null);
                  setDropAt(null);
                  if (ids !== null && at !== null) props.onMove(ids, at);
                }}
              >
                <Show when={dropAt() === i()}>
                  <div
                    class="absolute rounded bg-accent"
                    classList={{
                      '-top-1.5 right-0 left-5 h-0.5': !props.grid,
                      '-left-3.5 top-0 bottom-6 w-0.5': !!props.grid,
                    }}
                  />
                </Show>
                <Show when={dropAt() === i() + 1 && props.grid}>
                  <div class="absolute top-0 bottom-6 -right-3.5 w-0.5 rounded bg-accent" />
                </Show>
                <Show when={!props.grid}>
                  <span class="w-4 shrink-0 pt-0.5 text-right text-ink-muted text-xs tabular-nums">
                    {i() + 1}
                  </span>
                </Show>
                <button
                  type="button"
                  data-testid="pptx-thumbnail"
                  aria-label={`Slide ${i() + 1}${slide.title ? `: ${slide.title}` : ''}`}
                  aria-current={i() === props.current ? 'true' : undefined}
                  aria-selected={isSelected(slide.id)}
                  class="relative min-w-0 flex-1 overflow-hidden rounded-sm border-2 bg-page outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                  classList={{
                    'border-accent': i() === props.current,
                    'border-accent/50':
                      i() !== props.current && isSelected(slide.id),
                    'border-transparent':
                      i() !== props.current && !isSelected(slide.id),
                    'opacity-50': slide.hidden,
                  }}
                  style={{ 'aspect-ratio': `${1 / props.aspect}` }}
                  onClick={(e) =>
                    props.onSelect(i(), {
                      shift: e.shiftKey,
                      toggle: e.metaKey || e.ctrlKey,
                    })
                  }
                  onDblClick={() => props.onOpen?.(i())}
                >
                  <BitmapCanvas
                    class="absolute inset-0 size-full"
                    bitmap={props.thumbnail(slide)}
                    width={props.thumbnailPixels}
                    height={props.thumbnailPixels * props.aspect}
                  />
                  <SlidePeers peers={props.peersOn?.(slide.id) ?? []} />
                </button>
                <Show when={props.grid}>
                  <div class="flex items-center justify-between px-0.5 text-ink-muted text-xs">
                    <span class="tabular-nums">
                      {i() + 1}
                      <Show when={slide.hidden}> (hidden)</Show>
                    </span>
                    <Show
                      when={
                        slide.transition && slide.transition.kind !== 'none'
                      }
                    >
                      <span title={`Transition: ${slide.transition?.kind}`}>
                        ★
                      </span>
                    </Show>
                  </div>
                </Show>
                <Show when={!props.readonly && !props.grid}>
                  <div class="absolute top-1 right-1 hidden flex-col gap-0.5 rounded-md bg-surface/90 p-0.5 shadow group-hover:flex group-focus-within:flex">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      label="Duplicate slide"
                      tooltip="Duplicate slide"
                      onClick={() => props.onDuplicate(slide.id)}
                    >
                      <CopyIcon />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      label={slide.hidden ? 'Show slide' : 'Hide slide'}
                      tooltip={slide.hidden ? 'Show slide' : 'Hide slide'}
                      onClick={() => props.onToggleHidden(slide)}
                    >
                      {slide.hidden ? <EyeIcon /> : <EyeSlashIcon />}
                    </Button>
                    <Show when={props.slides.length > 1}>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        label="Delete slide"
                        tooltip="Delete slide"
                        onClick={() => props.onDelete([slide.id])}
                      >
                        <TrashIcon />
                      </Button>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
          <Show when={dropAt() === props.slides.length && !props.grid}>
            <div class="ml-5 h-0.5 rounded bg-accent" />
          </Show>
        </ContextMenu.Trigger>
        <Show when={props.menu}>
          <ContextMenu.Portal>
            <ContextMenuContent class="w-60" data-testid="pptx-rail-menu">
              {props.menu!(menuSlide())}
            </ContextMenuContent>
          </ContextMenu.Portal>
        </Show>
      </ContextMenu>
      <Show when={!props.readonly && !props.grid}>
        <div class="border-edge-muted border-t p-2">
          <Button
            size="sm"
            variant="outline"
            class="w-full"
            onClick={props.onAdd}
            label="New slide"
          >
            <PlusIcon />
            New slide
          </Button>
        </div>
      </Show>
    </nav>
  );
}
