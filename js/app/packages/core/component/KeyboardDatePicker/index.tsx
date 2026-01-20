import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import clickOutside from '@core/directive/clickOutside';
import CalendarDays from '@icon/regular/calendar.svg';
import MagnifyingGlass from '@icon/regular/magnifying-glass.svg';
import { format } from 'date-fns';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { parseDateFromDuration, parseDurationString } from './dateParser';
import { searchPresets } from './presets';

false && floatWithElement;
false && clickOutside;

export type KeyboardDatePickerProps = {
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
  anchorRef: HTMLElement;
  placeholder?: string;
  baseDate?: Date;
};

export function KeyboardDatePicker(props: KeyboardDatePickerProps) {
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [isShowingCalendar, setIsShowingCalendar] = createSignal(false);

  const baseDate = () => props.baseDate || new Date();

  // Parse the search query as a duration
  const parsedDuration = createMemo(() => {
    const query = searchQuery().trim();
    if (!query) return null;

    const parsed = parseDurationString(query);
    if (!parsed) return null;

    const date = parseDateFromDuration(query, baseDate());
    if (!date) return null;

    return {
      date,
      display: `${query} (${format(date, 'MM d, yyyy h:mm a')})`,
    };
  });

  // Filter presets based on search
  const filteredPresets = createMemo(() => {
    const query = searchQuery();

    // If we have a valid duration, don't show presets
    if (parsedDuration()) {
      return [];
    }

    return searchPresets(query);
  });

  // All options including parsed duration
  const allOptions = createMemo(() => {
    const duration = parsedDuration();
    const presets = filteredPresets();

    if (duration) {
      return [
        {
          type: 'duration' as const,
          date: duration.date,
          display: duration.display,
        },
      ];
    }

    return presets.map((preset) => ({
      type: 'preset' as const,
      preset,
      date: preset.getDate(baseDate()),
      display: preset.label,
    }));
  });

  // Reset selected index when options change
  createEffect(() => {
    allOptions();
    setSelectedIndex(0);
  });

  // Focus input on mount
  onMount(() => {
    inputRef?.focus();
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const options = allOptions();

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, options.length - 1));
        scrollToSelected();
        break;

      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        scrollToSelected();
        break;

      case 'Enter':
        e.preventDefault();
        if (options.length > 0) {
          const selected = options[selectedIndex()];
          handleSelect(selected.date);
        }
        break;

      case 'Escape':
        e.preventDefault();
        props.onClose();
        break;

      case 'Tab':
        // Let tab work normally but close on blur
        break;

      default:
        // Reset selection when typing
        if (e.key.length === 1) {
          setSelectedIndex(0);
        }
    }
  };

  const handleSelect = (date: Date) => {
    props.onChange(date);
    props.onClose();
  };

  const scrollToSelected = () => {
    const items = listRef?.querySelectorAll('[data-option]');
    const selected = items?.[selectedIndex()];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  };

  // Handle clicks outside
  const handleClickOutside = () => {
    props.onClose();
  };

  // Group presets by category
  const groupedPresets = createMemo(() => {
    const presets = filteredPresets();
    const grouped: Record<string, typeof presets> = {};

    presets.forEach((preset) => {
      const category = preset.category || 'other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(preset);
    });

    return grouped;
  });

  const categoryLabels: Record<string, string> = {
    quick: 'Quick',
    week: 'Week',
    month: 'Month',
    year: 'Year',
    other: 'Other',
  };

  return (
    <div
      class="absolute z-action-menu bg-dialog ring-1 ring-edge-muted w-80 max-h-96 overflow-hidden flex flex-col"
      use:floatWithElement={{ element: () => props.anchorRef }}
      use:clickOutside={handleClickOutside}
    >
      {/* Search input */}
      <div class="p-3 border-b border-edge-muted flex items-center gap-2">
        <MagnifyingGlass class="w-4 h-4 text-ink-muted flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            props.placeholder || 'Type "3d", "1w", or search presets...'
          }
          class="flex-1 bg-transparent outline-none text-sm placeholder:text-ink-muted"
        />
        <button
          onClick={() => setIsShowingCalendar(!isShowingCalendar())}
          class="p-1 hover:bg-active rounded transition-colors"
          title="Open calendar"
        >
          <CalendarDays class="w-4 h-4 text-ink-muted" />
        </button>
      </div>

      {/* Options list */}
      <div ref={listRef} class="flex-1 overflow-y-auto">
        <Switch>
          {/* Show parsed duration */}
          <Match when={parsedDuration()}>
            {(duration) => (
              <div class="p-2">
                <button
                  data-option
                  onClick={() => handleSelect(duration().date)}
                  class="w-full text-left px-3 py-2 text-sm hover:bg-active rounded transition-colors flex items-center justify-between"
                  classList={{
                    'bg-active': selectedIndex() === 0,
                  }}
                >
                  <span>{searchQuery()}</span>
                  <span class="text-ink-muted text-xs">
                    {format(duration().date, 'MMM d, yyyy h:mm a')}
                  </span>
                </button>
              </div>
            )}
          </Match>

          {/* Show presets */}
          <Match when={!parsedDuration() && filteredPresets().length > 0}>
            <div class="p-2">
              <Show when={!searchQuery()}>
                {/* Grouped presets */}
                <For each={Object.entries(groupedPresets())}>
                  {([category, presets], categoryIndex) => (
                    <>
                      <div class="px-3 py-1.5 text-xs font-medium text-ink-muted uppercase tracking-wider">
                        {categoryLabels[category]}
                      </div>
                      <For each={presets}>
                        {(preset, presetIndex) => {
                          const optionIndex = () => {
                            let index = 0;
                            const groups = Object.entries(groupedPresets());
                            for (let i = 0; i < categoryIndex(); i++) {
                              index += groups[i][1].length;
                            }
                            return index + presetIndex();
                          };

                          return (
                            <button
                              data-option
                              onClick={() =>
                                handleSelect(preset.getDate(baseDate()))
                              }
                              class="w-full text-left px-3 py-2 text-sm hover:bg-active rounded transition-colors flex items-center justify-between mb-0.5"
                              classList={{
                                'bg-active': selectedIndex() === optionIndex(),
                              }}
                            >
                              <span>{preset.label}</span>
                              <span class="text-ink-muted text-xs">
                                {format(
                                  preset.getDate(baseDate()),
                                  'MMM d, yyyy'
                                )}
                              </span>
                            </button>
                          );
                        }}
                      </For>
                    </>
                  )}
                </For>
              </Show>

              <Show when={searchQuery()}>
                {/* Flat list when searching */}
                <For each={filteredPresets()}>
                  {(preset, index) => (
                    <button
                      data-option
                      onClick={() => handleSelect(preset.getDate(baseDate()))}
                      class="w-full text-left px-3 py-2 text-sm hover:bg-active rounded transition-colors flex items-center justify-between mb-0.5"
                      classList={{
                        'bg-active': selectedIndex() === index(),
                      }}
                    >
                      <span>{preset.label}</span>
                      <span class="text-ink-muted text-xs">
                        {format(preset.getDate(baseDate()), 'MMM d, yyyy')}
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Match>

          {/* No results */}
          <Match when={!parsedDuration() && filteredPresets().length === 0}>
            <div class="p-4 text-center text-sm text-ink-muted">
              <p class="mb-2">No matching presets found.</p>
              <p class="text-xs">
                Try typing a duration like "3d" for 3 days or "1w" for 1 week.
              </p>
            </div>
          </Match>
        </Switch>
      </div>

      {/* Help text */}
      <div class="p-2 border-t border-edge-muted">
        <div class="text-xs text-ink-muted px-2">
          <span class="font-medium">Tips:</span> Use arrow keys to navigate,
          Enter to select. Type durations like{' '}
          <code class="font-mono bg-active px-1 py-0.5 rounded">3d</code>,{' '}
          <code class="font-mono bg-active px-1 py-0.5 rounded">1w</code>, or{' '}
          <code class="font-mono bg-active px-1 py-0.5 rounded">36h</code>.
        </div>
      </div>
    </div>
  );
}
