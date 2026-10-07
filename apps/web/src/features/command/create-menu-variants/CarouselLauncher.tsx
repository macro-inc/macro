import ArrowLeftIcon from '@phosphor/caret-left.svg';
import ArrowRightIcon from '@phosphor/caret-right.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { cn, Hotkey } from '@ui';
import { getNormalizedKeyString } from '@ui/components/Hotkey';
import { createSignal, For, Show } from 'solid-js';
import type { CreatableBlock } from '../types';
import { createMenuDetails, createMenuShortTagline } from './catalog';
import {
  CreateMenuEmpty,
  CreateMenuIcon,
  CreateMenuKey,
  CreateMenuStyles,
  createMenuAccent,
  createMenuTint,
} from './parts';
import {
  useVariantLauncher,
  type VariantLauncherController,
  type VariantLauncherProps,
} from './use-variant-launcher';

/** Card geometry, in px: resting and spotlighted width/height, and the gap. */
const CARD_W = 112;
const CARD_H = 150;
const FOCUS_W = 172;
const FOCUS_H = 188;
const GAP = 10;
/** Cards further than this from the spotlight are hidden. */
const VISIBLE_RADIUS = 5;
const ARROW_STEP = 3;
const WHEEL_THRESHOLD = 40;

/**
 * Horizontal offset of card `index`'s center from the spotlighted card's
 * center. Computed rather than measured so every card can glide to its new
 * slot with a plain CSS transition when the selection moves.
 */
function cardOffset(delta: number) {
  if (delta === 0) return 0;
  const steps = Math.abs(delta) - 1;
  return (
    Math.sign(delta) * (FOCUS_W / 2 + GAP + steps * (CARD_W + GAP) + CARD_W / 2)
  );
}

/**
 * Signed position of card `index` relative to the spotlight. Long strips wrap
 * around so the spotlight always has neighbors on both sides; a card crossing
 * the seam does so while hidden. Short ones (search results) stay linear.
 */
function cardDelta(index: number, selected: number, count: number) {
  const delta = index - selected;
  if (count < VISIBLE_RADIUS * 2 + 2) return delta;
  if (delta > count / 2) return delta - count;
  if (delta < -count / 2) return delta + count;
  return delta;
}

function cardOpacity(distance: number) {
  if (distance <= 1) return 1;
  if (distance === 2) return 0.9;
  if (distance === 3) return 0.65;
  if (distance === 4) return 0.35;
  if (distance === 5) return 0.15;
  return 0;
}

/**
 * A single strip of cards with the selection centered and spotlighted, its
 * neighbors stepping down and fading toward the edges. Arrows, dots (one per
 * group), the scroll wheel and the arrow keys move along it; clicking any
 * card creates it straight away.
 */
export function CarouselLauncher(props: VariantLauncherProps) {
  const c = useVariantLauncher(props, { navigation: 'carousel' });
  // Hover previews a card without recentering the strip under the pointer.
  const [hovered, setHovered] = createSignal<CreatableBlock>();
  const preview = () => hovered() ?? c.selected();

  let wheelDelta = 0;
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    wheelDelta += delta;
    if (Math.abs(wheelDelta) < WHEEL_THRESHOLD) return;
    c.step(Math.sign(wheelDelta));
    wheelDelta = 0;
  };

  const selectedIndex = () => c.indexOf(c.selected() as CreatableBlock);

  return (
    <div
      ref={c.setRootRef}
      tabindex={-1}
      class={cn(
        'elevated-surface relative isolate flex w-[66rem] max-w-[calc(100vw-16px)] flex-col overflow-hidden outline-none',
        preview() && createMenuAccent(preview()!)
      )}
    >
      <CreateMenuStyles />
      {/* Ambient wash in the spotlighted entry's color. */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_50%_100%,currentColor,transparent_65%)] opacity-[0.07] transition-colors duration-500"
      />

      <div class="flex items-center gap-4 px-8 pt-7 pb-5">
        <div class="flex size-11 items-center justify-center rounded-full border border-ink/10 bg-ink/4 text-ink">
          <PlusIcon class="size-5" />
        </div>
        <h1 class="text-xl font-semibold text-ink">Create</h1>
        <div class="ml-auto flex items-center gap-2 text-sm text-ink-muted">
          <kbd class="rounded-lg border border-ink/10 bg-ink/5 px-2.5 py-1 font-sans text-xs font-medium text-ink">
            Esc
          </kbd>
          to close
        </div>
      </div>

      <div class="px-8">
        <label class="mx-auto flex h-12 w-full max-w-3xl items-center gap-3 rounded-full border border-ink/10 bg-ink/[0.03] px-5 text-ink-muted transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
          <MagnifyingGlassIcon class="size-5 shrink-0 text-ink-extra-muted" />
          <input
            ref={c.setSearchRef}
            type="text"
            value={c.query()}
            onInput={(event) => c.setQuery(event.currentTarget.value)}
            onFocus={() => c.setSearchFocused(true)}
            onBlur={() => c.setSearchFocused(false)}
            placeholder="What do you want to create?"
            class="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none ring-0 placeholder:text-ink-placeholder focus:outline-none focus:ring-0"
          />
          <Show
            when={c.query()}
            fallback={
              <Show when={!c.searchFocused()}>
                <span class="flex items-center gap-2 text-sm text-ink-extra-muted">
                  <kbd class="flex size-7 items-center justify-center rounded-md border border-ink/10 bg-ink/5 font-sans text-xs text-ink">
                    <Hotkey shortcut={c.hotkeys.search()} />
                  </kbd>
                  Search or type
                </span>
              </Show>
            }
          >
            <button
              type="button"
              aria-label="Clear search"
              class="flex size-7 items-center justify-center rounded-full text-ink-extra-muted hover:bg-ink/5 hover:text-ink-muted"
              onClick={() => c.setQuery('')}
            >
              <XIcon class="size-4" />
            </button>
          </Show>
        </label>
      </div>

      <Show
        when={c.items().length > 0}
        fallback={<CreateMenuEmpty query={c.query()} />}
      >
        <div class="relative mt-4">
          <div
            class="relative h-[232px] overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
            onWheel={onWheel}
            onPointerLeave={() => setHovered(undefined)}
          >
            <For each={c.items()}>
              {(item, index) => (
                <CarouselCard
                  item={item}
                  index={index()}
                  delta={cardDelta(index(), selectedIndex(), c.items().length)}
                  hovered={hovered() === item}
                  onHover={setHovered}
                  controller={c}
                />
              )}
            </For>
          </div>

          <Show when={c.items().length > 1}>
            <CarouselArrow side="left" onClick={() => c.step(-ARROW_STEP)} />
            <CarouselArrow side="right" onClick={() => c.step(ARROW_STEP)} />
          </Show>
        </div>

        <div class="flex h-10 items-center justify-center px-16">
          <Show when={preview()} keyed>
            {(item) => (
              <p class="create-menu-fade-up line-clamp-1 max-w-2xl text-center text-sm text-ink-muted">
                <span class="font-medium text-ink">{item.label}</span>
                <Show when={createMenuDetails(item)}>
                  {(details) => <> — {details().details}</>}
                </Show>
              </p>
            )}
          </Show>
        </div>

        <div class="relative flex items-center justify-center gap-2 px-8 pt-1 pb-6">
          <For each={c.sections()}>
            {(section) => {
              const active = () =>
                section.items.includes(c.selected() as CreatableBlock);
              return (
                <button
                  type="button"
                  aria-label={section.group.label}
                  title={section.group.label}
                  class={cn(
                    'h-2 rounded-full transition-all duration-300',
                    active()
                      ? 'w-6 bg-current'
                      : 'w-2 bg-ink/20 hover:bg-ink/35'
                  )}
                  onClick={() => {
                    const first = section.items[0];
                    if (first) c.select(first);
                  }}
                />
              );
            }}
          </For>
          <span class="absolute right-8 hidden items-center gap-1.5 text-xs text-ink-extra-muted md:flex">
            <kbd
              class={cn(
                'rounded-md border px-1.5 py-px font-sans text-xxs transition-colors',
                c.shiftHeld()
                  ? 'border-current bg-current/10'
                  : 'border-ink/10 text-ink-muted'
              )}
            >
              {getNormalizedKeyString({ shortcut: 'shift' })}
            </kbd>
            New split
          </span>
        </div>
      </Show>
    </div>
  );
}

function CarouselCard(props: {
  item: CreatableBlock;
  index: number;
  /** Signed slots from the spotlight; 0 is the spotlighted card. */
  delta: number;
  hovered: boolean;
  onHover: (item: CreatableBlock) => void;
  controller: VariantLauncherController;
}) {
  const c = props.controller;
  const distance = () => Math.abs(props.delta);
  const focused = () => distance() === 0;
  const hidden = () => distance() > VISIBLE_RADIUS;

  return (
    <button
      type="button"
      data-launcher-index={props.index}
      tabindex={-1}
      aria-hidden={hidden()}
      class={cn(
        'group absolute top-1/2 flex flex-col items-center rounded-2xl border px-2.5 text-center outline-none',
        'transition-[left,width,height,opacity,transform,border-color,background-color,box-shadow] duration-300 ease-out',
        createMenuAccent(props.item),
        focused()
          ? 'justify-center border-current/45 bg-current/[0.07] shadow-lg shadow-drop-shadow'
          : 'justify-center border-ink/8 bg-ink/[0.03]',
        !focused() && props.hovered && '-translate-y-1 border-ink/18',
        hidden() && 'pointer-events-none'
      )}
      style={{
        left: `calc(50% + ${cardOffset(props.delta)}px)`,
        width: `${focused() ? FOCUS_W : CARD_W}px`,
        height: `${focused() ? FOCUS_H : CARD_H}px`,
        opacity: cardOpacity(distance()),
        translate: '-50% -50%',
      }}
      onPointerEnter={() => props.onHover(props.item)}
      onClick={() => c.run(props.item)}
    >
      <Show when={focused()}>
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-current opacity-20 blur-2xl"
        />
      </Show>

      <Show when={!c.searchFocused() && distance() <= 3}>
        <CreateMenuKey
          item={props.item}
          class={cn(
            'absolute top-2 right-2 border-ink/10 px-1 text-[10px] transition-opacity',
            focused() || props.hovered ? 'opacity-90' : 'opacity-0'
          )}
        />
      </Show>

      <div
        class={cn(
          'flex shrink-0 items-center justify-center transition-all duration-300 ease-out',
          createMenuTint(props.item),
          focused() ? 'size-14 rounded-2xl' : 'size-11 rounded-xl'
        )}
      >
        <CreateMenuIcon
          item={props.item}
          active={focused() || props.hovered}
          class={cn(
            'transition-all duration-300',
            focused() ? 'size-7' : 'size-5.5'
          )}
        />
      </div>

      <div
        class={cn(
          'mt-3 font-medium text-ink transition-all duration-300',
          focused() ? 'text-[15px] font-semibold' : 'text-[13px]'
        )}
      >
        {props.item.label}
      </div>
      <div
        class={cn(
          'mt-1 line-clamp-2 leading-snug text-ink-muted',
          focused() ? 'text-xs' : 'text-[11px] text-ink-extra-muted'
        )}
      >
        {createMenuShortTagline(props.item)}
      </div>
    </button>
  );
}

function CarouselArrow(props: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      tabindex={-1}
      aria-label={props.side === 'left' ? 'Previous' : 'Next'}
      class={cn(
        'absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-ink/10 bg-surface text-ink shadow-md shadow-drop-shadow transition-colors hover:bg-ink/5',
        props.side === 'left' ? 'left-5' : 'right-5'
      )}
      onClick={props.onClick}
    >
      <Show
        when={props.side === 'left'}
        fallback={<ArrowRightIcon class="size-5" />}
      >
        <ArrowLeftIcon class="size-5" />
      </Show>
    </button>
  );
}
