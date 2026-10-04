/**
 * The slide list: numbered thumbnails, drag to reorder, and per-slide
 * actions.
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
  /** Slide aspect ratio (height / width). */
  aspect: number;
  thumbnail: (slide: SlideOutline) => ImageBitmap | undefined;
  thumbnailPixels: number;
  readonly: boolean;
  onSelect: (index: number) => void;
  onMove: (slideId: number, to: number) => void;
  onAdd: () => void;
  onDuplicate: (slideId: number) => void;
  onDelete: (slideId: number) => void;
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
  const [dragging, setDragging] = createSignal<number | null>(null);
  const [menuSlide, setMenuSlide] = createSignal<SlideOutline>();
  const [dropAt, setDropAt] = createSignal<number | null>(null);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      props.onSelect(props.current + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      !props.readonly
    ) {
      const slide = props.slides[props.current];
      if (slide && props.slides.length > 1) {
        event.preventDefault();
        props.onDelete(slide.id);
      }
    }
  };

  return (
    <nav
      aria-label="Slides"
      data-testid="pptx-slide-rail"
      class="flex h-full w-44 shrink-0 flex-col border-edge-muted border-r bg-panel"
    >
      <ContextMenu>
        <ContextMenu.Trigger
          as="div"
          class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 outline-none"
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
            if (slide && index !== props.current) props.onSelect(index);
          }}
        >
          <For each={props.slides}>
            {(slide, i) => (
              <div
                class="group relative flex gap-1.5"
                data-slide-index={i()}
                draggable={!props.readonly}
                onDragStart={(e) => {
                  setDragging(slide.id);
                  e.dataTransfer?.setData('text/plain', String(slide.id));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (dragging() === null) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropAt(
                    e.clientY < rect.top + rect.height / 2 ? i() : i() + 1
                  );
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropAt(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragging();
                  const at = dropAt();
                  setDragging(null);
                  setDropAt(null);
                  if (id === null || at === null) return;
                  const from = props.slides.findIndex((s) => s.id === id);
                  const to = at > from ? at - 1 : at;
                  if (to !== from) props.onMove(id, to);
                }}
              >
                <Show when={dropAt() === i()}>
                  <div class="absolute -top-1.5 right-0 left-5 h-0.5 rounded bg-accent" />
                </Show>
                <span class="w-4 shrink-0 pt-0.5 text-right text-ink-muted text-xs tabular-nums">
                  {i() + 1}
                </span>
                <button
                  type="button"
                  data-testid="pptx-thumbnail"
                  aria-label={`Slide ${i() + 1}${slide.title ? `: ${slide.title}` : ''}`}
                  aria-current={i() === props.current ? 'true' : undefined}
                  class="relative min-w-0 flex-1 overflow-hidden rounded-sm border-2 bg-page outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                  classList={{
                    'border-accent': i() === props.current,
                    'border-transparent': i() !== props.current,
                    'opacity-50': slide.hidden,
                  }}
                  style={{ 'aspect-ratio': `${1 / props.aspect}` }}
                  onClick={() => props.onSelect(i())}
                >
                  <BitmapCanvas
                    class="absolute inset-0 size-full"
                    bitmap={props.thumbnail(slide)}
                    width={props.thumbnailPixels}
                    height={props.thumbnailPixels * props.aspect}
                  />
                  <SlidePeers peers={props.peersOn?.(slide.id) ?? []} />
                </button>
                <Show when={!props.readonly}>
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
                        onClick={() => props.onDelete(slide.id)}
                      >
                        <TrashIcon />
                      </Button>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
          <Show when={dropAt() === props.slides.length}>
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
      <Show when={!props.readonly}>
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
