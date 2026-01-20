import { createSignal, For, Show } from 'solid-js';
import { format } from 'date-fns';
import { useDateSearch } from './useDateSearch';
import type { DateOption } from './useDateSearch';

/**
 * Example component demonstrating how to use the useDateSearch hook
 * to build custom date picker interfaces
 */
export function DateSearchExample() {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedDate, setSelectedDate] = createSignal<Date | null>(null);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  // Use the hook with reactive search query
  const dateOptions = useDateSearch({
    query: searchQuery,
    baseDate: new Date(), // Optional: defaults to current date
  });

  const handleSelect = (option: DateOption) => {
    setSelectedDate(option.date);
    setSearchQuery('');
    console.log('Selected:', option);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const options = dateOptions();

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, options.length - 1));
        break;

      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;

      case 'Enter':
        e.preventDefault();
        if (options.length > 0) {
          handleSelect(options[selectedIndex()]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        setSearchQuery('');
        setSelectedIndex(0);
        break;
    }
  };

  return (
    <div class="p-6 max-w-2xl mx-auto space-y-4">
      <h2 class="text-xl font-bold">Date Search Hook Example</h2>

      {/* Search Input */}
      <div class="space-y-2">
        <label class="text-sm font-medium">Search for a date</label>
        <input
          type="text"
          value={searchQuery()}
          onInput={(e) => {
            setSearchQuery(e.currentTarget.value);
            setSelectedIndex(0); // Reset selection when typing
          }}
          onKeyDown={handleKeyDown}
          placeholder='Try "3d", "feb 17", "next week", or "tomorrow"...'
          class="w-full px-3 py-2 border border-edge-muted rounded bg-dialog focus:outline-none focus:border-accent"
        />
      </div>

      {/* Results */}
      <Show when={dateOptions().length > 0}>
        <div class="border border-edge-muted rounded overflow-hidden">
          <div class="p-2 bg-active text-xs font-medium text-ink-muted">
            {dateOptions().length} result{dateOptions().length !== 1 ? 's' : ''}
          </div>

          <div class="divide-y divide-edge-muted">
            <For each={dateOptions()}>
              {(option, index) => (
                <button
                  onClick={() => handleSelect(option)}
                  class="w-full px-3 py-2 text-left hover:bg-active transition-colors flex items-center justify-between"
                  classList={{
                    'bg-active': selectedIndex() === index(),
                  }}
                >
                  <div class="flex items-center gap-3">
                    {/* Type indicator */}
                    <span
                      class="text-xs px-1.5 py-0.5 rounded font-mono"
                      classList={{
                        'bg-accent text-dialog': option.type === 'duration',
                        'bg-ink-muted text-dialog': option.type === 'natural',
                        'bg-active ring-1 ring-edge-muted':
                          option.type === 'preset',
                      }}
                    >
                      {option.type}
                    </span>

                    {/* Main text */}
                    <span class="font-medium">{option.displayText}</span>
                  </div>

                  {/* Secondary text (formatted date) */}
                  <span class="text-sm text-ink-muted">
                    {option.secondaryText}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* No results */}
      <Show when={searchQuery() && dateOptions().length === 0}>
        <div class="p-4 border border-edge-muted rounded text-center text-sm text-ink-muted">
          No matching dates found for "{searchQuery()}"
        </div>
      </Show>

      {/* Selected Date Display */}
      <Show when={selectedDate()}>
        <div class="p-4 bg-accent/10 border border-accent rounded">
          <div class="text-sm font-medium mb-1">Selected Date:</div>
          <div class="text-lg font-mono">
            {format(selectedDate()!, 'EEEE, MMMM d, yyyy')}
          </div>
          <div class="text-sm text-ink-muted mt-1">
            {format(selectedDate()!, 'h:mm a')} •{' '}
            {format(selectedDate()!, 'yyyy-MM-dd HH:mm:ss')}
          </div>
        </div>
      </Show>

      {/* Examples */}
      <div class="mt-8 p-4 bg-active rounded">
        <h3 class="font-medium mb-2">Examples to try:</h3>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span class="font-mono bg-dialog px-1 py-0.5 rounded">3d</span>
            <span class="text-ink-muted ml-2">3 days from now</span>
          </div>
          <div>
            <span class="font-mono bg-dialog px-1 py-0.5 rounded">1w</span>
            <span class="text-ink-muted ml-2">1 week from now</span>
          </div>
          <div>
            <span class="font-mono bg-dialog px-1 py-0.5 rounded">feb 17</span>
            <span class="text-ink-muted ml-2">February 17th</span>
          </div>
          <div>
            <span class="font-mono bg-dialog px-1 py-0.5 rounded">
              march 3 2025
            </span>
            <span class="text-ink-muted ml-2">Specific date</span>
          </div>
          <div>
            <span class="font-mono bg-dialog px-1 py-0.5 rounded">
              tomorrow
            </span>
            <span class="text-ink-muted ml-2">Search presets</span>
          </div>
          <div>
            <span class="font-mono bg-dialog px-1 py-0.5 rounded">monday</span>
            <span class="text-ink-muted ml-2">Next Monday</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Minimal example showing just the hook usage
 */
export function MinimalDateSearchExample() {
  const [query, setQuery] = createSignal('');

  // The hook returns a reactive array of date options
  const options = useDateSearch({ query });

  return (
    <div>
      <input
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        placeholder="Enter date..."
      />

      <For each={options()}>
        {(option) => (
          <div>
            {option.displayText} - {option.secondaryText}
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * Example with custom base date (e.g., for scheduling relative to a specific date)
 */
export function CustomBaseDateExample() {
  const [query, setQuery] = createSignal('');
  const projectStartDate = new Date('2025-01-01T09:00:00');

  // All relative dates will be calculated from the project start date
  const options = useDateSearch({
    query,
    baseDate: projectStartDate,
  });

  return (
    <div class="space-y-4">
      <div class="text-sm text-ink-muted">
        Base date: {format(projectStartDate, 'MMMM d, yyyy')}
      </div>

      <input
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        placeholder='Try "1w" for 1 week after project start...'
        class="w-full px-3 py-2 border border-edge-muted rounded"
      />

      <div class="space-y-1">
        <For each={options().slice(0, 5)}>
          {(option) => (
            <div class="p-2 bg-active rounded text-sm">
              <span class="font-medium">{option.displayText}</span>
              <span class="text-ink-muted ml-2">→ {option.secondaryText}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
