import XIcon from '@icon/regular/x.svg?component-solid';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Hotkey } from '@core/component/Hotkey';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { createSignal, createEffect, onCleanup, Show } from 'solid-js';

export const SoupSearchbar = () => {
  const { searchText, setSearchText } = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [ref, setRef] = createSignal<HTMLInputElement | undefined>();
  let measureSpan: HTMLSpanElement | undefined;

  const [searchFocused, setSearchFocused] = createSignal(false);
  const [measuredWidth, setMeasuredWidth] = createSignal(0);

  createEffect(() => {
    if (measureSpan) {
      measureSpan.textContent = searchText() || '';
      setMeasuredWidth(measureSpan.scrollWidth);
    }
  });

  const searchHotkey = registerHotkey({
    hotkey: ['cmd+f'],
    scopeId: panel.splitHotkeyScope,
    description: 'Search',
    keyDownHandler: () => {
      ref()?.focus();
      return true;
    },
  });

  onCleanup(searchHotkey.dispose);

  const MIN_INPUT_WIDTH = 48;

  const inputWidth = () => {
    if (!searchText() && !searchFocused()) return 0;
    return Math.max(MIN_INPUT_WIDTH, measuredWidth());
  };

  return (
    <div class="size-full flex items-center shrink-0 grow min-w-0 mobile:-order-2">
      <Tooltip
        class="size-full"
        placement="bottom-start"
        tooltip={<LabelAndHotKey label="Search" shortcut="⌘F" />}
      >
        <div
          class="relative flex items-center gap-1.5 h-full rounded-md py-0.5 mobile:h-9 px-2.5 mobile:min-w-35"
          classList={{
            'bg-accent text-panel': !!searchText() && !searchFocused(),
            'text-ink-muted bg-ink/10 hover:text-ink':
              !searchText() && !searchFocused(),
            'bg-ink/15 text-ink': searchFocused(),
          }}
          onMouseDown={(e) => {
            if (e.target !== ref()) {
              e.preventDefault();
              ref()?.focus();
            }
          }}
        >
          <SearchIcon class="size-4.5 shrink-0" />
          <span
            ref={(el) => {
              measureSpan = el;
            }}
            class="invisible absolute whitespace-pre"
            aria-hidden="true"
          />
          <Show when={!searchText() && !searchFocused()}>
            <span class="leading-none pointer-events-none text-sm">Search</span>
          </Show>
          <input
            ref={setRef}
            type="text"
            value={searchText()}
            onInput={(e) => setSearchText(e.currentTarget.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (
                e.key === 'Escape' ||
                e.key === 'Enter' ||
                e.key === 'ArrowDown'
              ) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            class="p-0 bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 cursor-default w-full"
            style={{ width: `${inputWidth()}px` }}
          />
          <Show when={!searchFocused() && !searchText()}>
            <div class="ml-auto flex border border-edge text-xs rounded-md items-center px-1 py-px">
              <Hotkey shortcut="cmd+f" />
            </div>
          </Show>
          <Show when={searchText()}>
            <button
              type="button"
              class="ml-auto size-4.5 shrink-0 hover:opacity-60"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSearchText('');
              }}
            >
              <XIcon class="size-4.5" />
            </button>
          </Show>
        </div>
      </Tooltip>
    </div>
  );
};
