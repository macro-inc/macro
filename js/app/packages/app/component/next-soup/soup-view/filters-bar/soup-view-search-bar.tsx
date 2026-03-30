import XIcon from '@icon/regular/x.svg?component-solid';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { cn } from '@ui/utils/classname';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Hotkey } from '@core/component/Hotkey';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { createSignal, createEffect, onCleanup, Show } from 'solid-js';

type SearchbarVariant = 'filled' | 'secondary';

interface SoupSearchbarProps {
  variant?: SearchbarVariant;
  autoFocus?: boolean;
  onDismiss?: () => void;
}

const variantStyles: Record<SearchbarVariant, string> = {
  filled:
    'bg-ink/5 text-ink-muted hover:bg-ink/7 hover:text-ink border-transparent focus-within:bg-ink/7 focus-within:text-ink',
  secondary:
    'bg-transparent text-ink-muted border-edge-muted hover:bg-input hover:text-ink focus-within:bg-input focus-within:text-ink',
};

export const SoupSearchbar = (props: SoupSearchbarProps) => {
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

  createEffect(() => {
    ref();
    if (props.autoFocus) {
      queueMicrotask(() => {
        ref()?.focus();
      });
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
    <div class="w-full flex items-center shrink-0 grow min-w-0 mobile:-order-2">
      <Tooltip
        class="w-full"
        placement="bottom-start"
        tooltip={<LabelAndHotKey label="Search" shortcut="⌘F" />}
      >
        <div
          class={cn(
            'relative flex items-center gap-1 rounded-xs py-1.5 mobile:h-9 pl-2 pr-1 mobile:min-w-35 border text-xs',
            variantStyles[props.variant ?? 'secondary']
          )}
          onMouseDown={(e) => {
            if (e.target !== ref()) {
              e.preventDefault();
              ref()?.focus();
            }
          }}
        >
          <SearchIcon class="size-4 shrink-0" />
          <span
            ref={(el) => {
              measureSpan = el;
            }}
            class="invisible absolute whitespace-pre"
            aria-hidden="true"
          />
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
                if (e.key === 'Escape') props.onDismiss?.();
              }
            }}
            class="peer p-0 bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 cursor-default w-full"
            style={{ width: `${inputWidth()}px` }}
          />
          <Show when={!searchText()}>
            <span class="text-ink-placeholder leading-none pointer-events-none text-sm peer-focus:hidden">
              Search
            </span>
          </Show>
          <Show when={!searchText() && !props.onDismiss}>
            <div class="absolute -right-2 top-1/2 -translate-1/2 flex border border-edge-muted text-xs rounded-md items-center px-1 py-px peer-focus:hidden">
              <Hotkey shortcut="cmd+f" />
            </div>
          </Show>
          <Show when={searchText() || props.onDismiss}>
            <button
              type="button"
              class="ml-auto size-4 mobile:size-6 shrink-0 hover:opacity-60"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSearchText('');
                props.onDismiss?.();
              }}
            >
              <XIcon class="size-4 mobile:size-6" />
            </button>
          </Show>
        </div>
      </Tooltip>
    </div>
  );
};
