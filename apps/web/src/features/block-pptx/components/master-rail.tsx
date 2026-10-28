/**
 * Slide Master view's thumbnail pane: each slide master, numbered, with its
 * layouts indented beneath it, as PowerPoint lists them. Hovering a page
 * says which slides use it; right-clicking one offers the layout actions.
 */

import { ContextMenuContent } from '@core/component/ContextMenu';
import type { DeckOutline, SlideOutline } from '@core/pptx-engine/types';
import { ContextMenu } from '@kobalte/core/context-menu';
import { createEffect, createSignal, For, type JSX, on, Show } from 'solid-js';
import {
  findMasterPage,
  type MasterPage,
  pageTooltip,
} from '../core/master-view';
import { BitmapCanvas } from './bitmap-canvas';

export interface MasterRailProps {
  /** The deck (slides, masters, and layouts). */
  deck: DeckOutline;
  /** The masters and layouts, in Slide Master view order. */
  pages: SlideOutline[];
  /** Position of the page edited. */
  current: number;
  /** Slide aspect ratio (height / width). */
  aspect: number;
  thumbnail: (page: SlideOutline) => ImageBitmap | undefined;
  thumbnailPixels: number;
  readonly: boolean;
  onSelect: (index: number) => void;
  /** Delete pressed on a page. */
  onDelete: (page: MasterPage) => void;
  /** Right-click menu items for a page. */
  menu: (page: MasterPage | undefined) => JSX.Element;
}

export function MasterRail(props: MasterRailProps) {
  let list!: HTMLDivElement;
  const [menuPage, setMenuPage] = createSignal<MasterPage>();
  // The page edited stays in view (a layout far down the list, say).
  createEffect(
    on(
      () => props.current,
      (index) =>
        list
          .querySelector(`[data-page-index="${index}"]`)
          ?.scrollIntoView({ block: 'nearest' })
    )
  );
  const pageAt = (index: number) => {
    const outline = props.pages[index];
    return outline ? findMasterPage(props.deck, outline.id) : undefined;
  };
  /** Each master's number (1, 2...) by page position. */
  const masterNumber = (index: number) =>
    props.pages
      .slice(0, index + 1)
      .filter((p) => !findMasterPage(props.deck, p.id)?.layout).length;

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      props.onSelect(
        Math.min(props.pages.length - 1, Math.max(0, props.current + step))
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      props.onSelect(event.key === 'Home' ? 0 : props.pages.length - 1);
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      !props.readonly
    ) {
      event.preventDefault();
      const page = pageAt(props.current);
      if (page) props.onDelete(page);
    }
  };

  return (
    <nav
      aria-label="Slide masters and layouts"
      data-testid="pptx-master-rail"
      class="flex h-full w-52 shrink-0 flex-col border-edge-muted border-r bg-panel"
    >
      <ContextMenu>
        <ContextMenu.Trigger
          as="div"
          ref={list}
          class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2 outline-none"
          tabIndex={0}
          data-testid="pptx-master-list"
          onKeyDown={onKeyDown}
          // A right press picks (and selects) the page its menu is for.
          onPointerDown={(e: PointerEvent) => {
            if (e.button !== 2) return;
            const el = (e.target as HTMLElement).closest<HTMLElement>(
              '[data-page-index]'
            );
            const index = el ? Number(el.dataset.pageIndex) : -1;
            setMenuPage(pageAt(index));
            if (index >= 0 && index !== props.current) props.onSelect(index);
          }}
        >
          <For each={props.pages}>
            {(outline, i) => {
              const page = () => findMasterPage(props.deck, outline.id);
              const isLayout = () => !!page()?.layout;
              return (
                <div
                  class="relative flex gap-1.5"
                  classList={{ 'mt-1.5': !isLayout() && i() > 0 }}
                  data-page-index={i()}
                >
                  <span class="w-4 shrink-0 pt-0.5 text-right text-ink-muted text-xs tabular-nums">
                    <Show when={!isLayout()}>{masterNumber(i())}</Show>
                  </span>
                  <Show when={isLayout()}>
                    {/* The line joining a master's layouts to it. */}
                    <span class="absolute top-[-0.375rem] bottom-0 left-[1.75rem] w-px bg-ink-muted/40" />
                    <span class="absolute top-1/2 left-[1.75rem] h-px w-2.5 bg-ink-muted/40" />
                  </Show>
                  <button
                    type="button"
                    data-testid="pptx-master-thumbnail"
                    data-kind={isLayout() ? 'layout' : 'master'}
                    data-page-id={outline.id}
                    aria-label={outline.layout}
                    aria-current={i() === props.current ? 'true' : undefined}
                    title={(() => {
                      const p = page();
                      return p ? pageTooltip(props.deck, p) : outline.layout;
                    })()}
                    class="relative min-w-0 overflow-hidden rounded-sm border-2 bg-page outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                    classList={{
                      'ml-4 flex-1': isLayout(),
                      'flex-1': !isLayout(),
                      'border-accent': i() === props.current,
                      'border-edge-muted': i() !== props.current,
                    }}
                    style={{
                      'aspect-ratio': `${1 / props.aspect}`,
                    }}
                    onClick={() => props.onSelect(i())}
                  >
                    <BitmapCanvas
                      class="absolute inset-0 size-full"
                      bitmap={props.thumbnail(outline)}
                      width={props.thumbnailPixels}
                      height={props.thumbnailPixels * props.aspect}
                    />
                  </button>
                </div>
              );
            }}
          </For>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="w-60" data-testid="pptx-master-menu">
            {props.menu(menuPage())}
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </nav>
  );
}
