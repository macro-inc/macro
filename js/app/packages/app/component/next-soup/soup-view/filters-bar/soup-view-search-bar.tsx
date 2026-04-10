import XIcon from '@icon/regular/x.svg?component-solid';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { cn } from '@ui/utils/classname';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Hotkey } from '@core/component/Hotkey';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { ENABLE_SEARCH_QUERY_OPERATORS } from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import {
  createSignal,
  createEffect,
  onCleanup,
  Show,
  createMemo,
} from 'solid-js';
import { QUERY_FILTERS } from '@app/component/next-soup/filters/query-filters';
import {
  detectActiveOperator,
  stripOperatorAtRange,
} from './parse-search-operators';
import {
  INDEX_OPTIONS,
  SearchOperatorAutocomplete,
  type AutocompleteOption,
} from './search-operator-autocomplete';
import { INDEX_OPTIONS as INDEX_OPTIONS_SOURCE } from './search-filter-controls';
import type { OperatorType } from './parse-search-operators';

const INDEX_QUERY_FILTERS = Object.fromEntries(
  INDEX_OPTIONS_SOURCE.map((o) => [o.value, o.queryFilters])
);

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
  const { searchText, setSearchText, soup, setQueryFilters } = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [ref, setRef] = createSignal<HTMLInputElement | undefined>();
  let measureSpan: HTMLSpanElement | undefined;

  const [searchFocused, setSearchFocused] = createSignal(false);
  const [measuredWidth, setMeasuredWidth] = createSignal(0);
  const [cursorPos, setCursorPos] = createSignal(0);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);

  const activeOperator = createMemo(() => {
    if (!ENABLE_SEARCH_QUERY_OPERATORS) return null;
    if (!searchFocused()) return null;
    return detectActiveOperator(searchText(), cursorPos());
  });

  createEffect(() => {
    if (activeOperator()) {
      setHighlightedIndex(0);
    }
  });

  const updateCursorPos = () => {
    const el = ref();
    if (el) setCursorPos(el.selectionStart ?? el.value.length);
  };

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

  const handleSelect = (type: OperatorType, option: AutocompleteOption) => {
    const op = activeOperator();
    if (!op) return;

    const newText = stripOperatorAtRange(
      searchText(),
      op.startIndex,
      op.endIndex
    );
    setSearchText(newText);

    switch (type) {
      case 'index': {
        for (const opt of INDEX_OPTIONS) {
          if (soup.filters.isActive(opt.id)) {
            soup.filters.toggle({ or: [opt.id] });
          }
        }
        soup.filters.toggle({ or: [option.id] });
        const qf = INDEX_QUERY_FILTERS[option.id];
        if (qf) setQueryFilters(qf);
        break;
      }
      case 'in': {
        if (!soup.filters.isActive('channels')) {
          for (const opt of INDEX_OPTIONS) {
            if (soup.filters.isActive(opt.id)) {
              soup.filters.toggle({ or: [opt.id] });
            }
          }
          soup.filters.toggle({ or: ['channels'] });
          setQueryFilters({
            ...QUERY_FILTERS.channels,
            channel_filters: {
              ...QUERY_FILTERS.channels.channel_filters,
              channel_ids: [option.id],
            },
          });
        } else {
          setQueryFilters((prev) => ({
            ...prev,
            channel_filters: {
              ...prev.channel_filters,
              channel_ids: [
                ...(prev.channel_filters?.channel_ids ?? []),
                option.id,
              ],
            },
          }));
        }
        break;
      }
      case 'from': {
        if (!soup.filters.isActive('channels')) {
          for (const opt of INDEX_OPTIONS) {
            if (soup.filters.isActive(opt.id)) {
              soup.filters.toggle({ or: [opt.id] });
            }
          }
          soup.filters.toggle({ or: ['channels'] });
          setQueryFilters({
            ...QUERY_FILTERS.channels,
            channel_filters: {
              ...QUERY_FILTERS.channels.channel_filters,
              sender_ids: [option.id],
            },
          });
        } else {
          setQueryFilters((prev) => ({
            ...prev,
            channel_filters: {
              ...prev.channel_filters,
              sender_ids: [
                ...(prev.channel_filters?.sender_ids ?? []),
                option.id,
              ],
            },
          }));
        }
        break;
      }
    }

    queueMicrotask(() => ref()?.focus());
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const input = e.currentTarget as HTMLInputElement | null;
    const op = activeOperator();

    if (op) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => i + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const dropdownEl = ref()
          ?.closest('[data-search-bar-wrapper]')
          ?.querySelector('[data-operator-dropdown]');
        if (dropdownEl) {
          const buttons = dropdownEl.querySelectorAll('button');
          const idx = highlightedIndex();
          if (buttons[idx]) {
            (buttons[idx] as HTMLButtonElement).click();
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        input?.blur();
        props.onDismiss?.();
        return;
      }
    } else {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        input?.blur();
        if (e.key === 'Escape') props.onDismiss?.();
      }
    }
  };

  return (
    <div
      class="w-full flex items-center shrink-0 grow min-w-0 mobile:-order-2"
      data-search-bar-wrapper
    >
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
            data-soup-search
            type="text"
            value={searchText()}
            onInput={(e) => {
              setSearchText(e.currentTarget.value);
              queueMicrotask(updateCursorPos);
            }}
            onClick={updateCursorPos}
            onFocus={() => {
              setSearchFocused(true);
              queueMicrotask(updateCursorPos);
            }}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={handleKeyDown}
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
          <Show when={activeOperator()}>
            {(op) => (
              <SearchOperatorAutocomplete
                activeOperator={op()}
                onSelect={handleSelect}
                onDismiss={() => ref()?.blur()}
                highlightedIndex={highlightedIndex}
                setHighlightedIndex={setHighlightedIndex}
              />
            )}
          </Show>
        </div>
      </Tooltip>
    </div>
  );
};
