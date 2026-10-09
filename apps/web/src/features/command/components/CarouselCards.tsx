import { getIconConfig } from '@core/component/EntityIcon';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { cn, Hotkey } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createMenuShortTagline } from '../core/create-menu-details';
import type { CreatableBlock } from '../types';

const CARD_WIDTH = 160;
const CARD_GAP = 10;

export function CarouselCards(props: {
  items: CreatableBlock[];
  showHotkeys?: boolean;
  selectedIndex: number;
  itemId: (item: CreatableBlock) => string;
  onSelect: (index: number) => void;
  onStep: (direction: number) => void;
  onChoose: (item: CreatableBlock) => void;
}) {
  const pages = () =>
    Array.from(
      { length: Math.ceil(props.items.length / 3) },
      (_, index) => index
    );

  return (
    <>
      <div class="relative">
        <div class="relative h-44 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]">
          <For each={props.items}>
            {(item, index) => {
              const delta = () => {
                const raw = index() - props.selectedIndex;
                if (props.items.length < 12) return raw;
                return (
                  raw -
                  Math.round(raw / props.items.length) * props.items.length
                );
              };
              const distance = () => Math.abs(delta());
              const active = () => distance() === 0;
              return (
                <button
                  type="button"
                  id={props.itemId(item)}
                  data-create-card
                  aria-label={`Create ${item.label}`}
                  aria-pressed={active()}
                  aria-hidden={distance() > 5}
                  tabindex={active() ? 0 : -1}
                  class={cn(
                    'absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 h-36 flex-col items-start rounded-xl border p-3 text-left outline-none transition-[left,opacity,background-color,box-shadow,border-color] duration-300 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent',
                    getIconConfig(item.blockName).foreground,
                    active()
                      ? 'border-current/30 bg-current/[0.04] shadow-[0_0_20px_0] shadow-current/[0.06]'
                      : 'border-ink/8 bg-ink/[0.03] hover:border-ink/20',
                    distance() > 5 && 'invisible'
                  )}
                  style={{
                    left: `calc(50% + ${delta() * (CARD_WIDTH + CARD_GAP)}px)`,
                    width: `${CARD_WIDTH}px`,
                    opacity:
                      distance() <= 1
                        ? 1
                        : distance() === 2
                          ? 0.9
                          : distance() === 3
                            ? 0.65
                            : distance() === 4
                              ? 0.35
                              : 0.15,
                  }}
                  onClick={() => props.onChoose(item)}
                >
                  <div
                    class={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg',
                      getIconConfig(item.blockName).background
                    )}
                  >
                    <div class="size-5 [&_svg]:size-full">
                      <Dynamic component={item.icon} />
                    </div>
                  </div>
                  <Show when={props.showHotkeys}>
                    <span class="absolute top-3 right-3 rounded-md border border-ink/12 px-1.5 py-px text-xxs text-ink-muted">
                      <Hotkey
                        token={item.hotkeyToken}
                        shortcut={
                          Array.isArray(item.hotkey)
                            ? item.hotkey[0]
                            : item.hotkey
                        }
                      />
                    </span>
                  </Show>
                  <div class="mt-2.5 text-sm font-medium text-ink">
                    {item.label}
                  </div>
                  <p class="mt-1 text-left text-xs leading-relaxed text-ink-muted">
                    {createMenuShortTagline(item)}
                  </p>
                </button>
              );
            }}
          </For>
        </div>
      </div>
      <div
        class={cn(
          'flex h-12 items-center justify-center gap-5 px-5 pb-4',
          props.items.length <= 1 && 'invisible'
        )}
      >
        <button
          type="button"
          aria-label="Previous create option"
          class="flex size-8 shrink-0 items-center justify-center rounded-full border border-edge-muted bg-dialog text-ink-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => props.onStep(-1)}
        >
          <CaretLeft class="size-4" />
        </button>
        <div class="flex items-center gap-2">
          <For each={pages()}>
            {(page) => (
              <button
                type="button"
                aria-label={`Browse create options ${page * 3 + 1}–${Math.min(page * 3 + 3, props.items.length)}`}
                aria-pressed={Math.floor(props.selectedIndex / 3) === page}
                class="flex h-6 items-center justify-center outline-none focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => props.onSelect(page * 3)}
              >
                <span
                  class={cn(
                    'h-1.5 rounded-full transition-[width] motion-reduce:transition-none',
                    Math.floor(props.selectedIndex / 3) === page
                      ? 'w-5 bg-ink/60'
                      : 'w-1.5 bg-ink/20'
                  )}
                />
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          aria-label="Next create option"
          class="flex size-8 shrink-0 items-center justify-center rounded-full border border-edge-muted bg-dialog text-ink-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => props.onStep(1)}
        >
          <CaretRight class="size-4" />
        </button>
      </div>
    </>
  );
}
