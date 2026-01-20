# Date Search Hook

A powerful reactive hook for parsing and searching dates in SolidJS applications. Supports natural language input, duration DSL, and preset searching.

## Features

- 🔍 **Natural language parsing**: "feb 17", "march 3 2025", "tomorrow"
- ⏱️ **Duration DSL**: "3d" (3 days), "1w" (1 week), "36h" (36 hours)
- 📅 **Smart presets**: Search through common date presets
- ⚡ **Reactive**: Automatically updates when query changes
- 🎯 **Intelligent scoring**: Results ranked by relevance
- 📆 **Relative dates**: All calculations relative to configurable base date

## Installation

```typescript
import { useDateSearch } from '@core/component/KeyboardDatePicker';
```

## Basic Usage

```typescript
import { createSignal } from 'solid-js';
import { useDateSearch } from '@core/component/KeyboardDatePicker';

function MyDatePicker() {
  const [query, setQuery] = createSignal('');
  
  // Returns a reactive array of date options
  const dateOptions = useDateSearch({ query });
  
  return (
    <div>
      <input
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        placeholder="Type '3d' or 'feb 17'..."
      />
      
      <For each={dateOptions()}>
        {(option) => (
          <button onClick={() => handleSelect(option.date)}>
            {option.displayText} - {option.secondaryText}
          </button>
        )}
      </For>
    </div>
  );
}
```

## API

### `useDateSearch(params)`

#### Parameters

- `query: Accessor<string>` - Reactive search query
- `baseDate?: Date` - Optional base date for relative calculations (defaults to current date)

#### Returns

`Accessor<DateOption[]>` - Reactive array of date options

#### DateOption Type

```typescript
interface DateOption {
  id: string;                    // Unique identifier
  displayText: string;            // Primary display text
  secondaryText?: string;         // Formatted date string
  date: Date;                     // The actual Date object
  type: 'duration' | 'preset' | 'natural' | 'absolute';
  score?: number;                 // Relevance score (0-100)
}
```

## Supported Input Formats

### Duration DSL

| Input | Description |
|-------|-------------|
| `30min` | 30 minutes from now |
| `2h` | 2 hours from now |
| `3d` | 3 days from now |
| `1w` | 1 week from now |
| `2m` | 2 months from now |
| `1y` | 1 year from now |
| `1.5d` | 1.5 days from now |

### Natural Date Formats

| Input | Description |
|-------|-------------|
| `feb 17` | February 17th (smart year selection) |
| `march 3 2025` | March 3, 2025 |
| `January 1` | January 1st |
| `3/15` | March 15th (M/D format) |
| `12/25/2024` | December 25, 2024 |
| `2024-03-15` | ISO date format |
| `15-03-2024` | European format |
| `17 Feb` | Day-month format |

### Relative Dates

| Input | Description |
|-------|-------------|
| `today` | Current date |
| `tomorrow` | Next day |
| `yesterday` | Previous day |
| `monday` | Next Monday |
| `fri` | Next Friday |

### Preset Search

The hook searches through built-in presets like:
- "End of week"
- "Next month"
- "In 3 days"
- "End of year"
- And many more...

## Advanced Usage

### Custom Base Date

```typescript
const projectStartDate = new Date('2025-01-01');

const dateOptions = useDateSearch({
  query,
  baseDate: projectStartDate // All relative dates from Jan 1, 2025
});
```

### With Keyboard Navigation

```typescript
function KeyboardNavigablePicker() {
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const dateOptions = useDateSearch({ query });

  const handleKeyDown = (e: KeyboardEvent) => {
    const options = dateOptions();
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (options[selectedIndex()]) {
          selectDate(options[selectedIndex()].date);
        }
        break;
    }
  };

  // ... render logic
}
```

## Helper Functions

### `parseNaturalDate(input: string, baseDate?: Date)`

Parse natural language date strings.

```typescript
import { parseNaturalDate } from '@core/component/KeyboardDatePicker';

const date = parseNaturalDate('feb 17'); // February 17th of current/next year
const date2 = parseNaturalDate('march 3 2025'); // March 3, 2025
```

### `parseDateFromDuration(input: string, baseDate?: Date)`

Parse duration DSL strings.

```typescript
import { parseDateFromDuration } from '@core/component/KeyboardDatePicker';

const date = parseDateFromDuration('3d'); // 3 days from now
const date2 = parseDateFromDuration('1w', customBase); // 1 week from customBase
```

### `formatDateWithContext(date: Date, baseDate?: Date)`

Format dates with contextual information.

```typescript
import { formatDateWithContext } from '@core/component/KeyboardDatePicker';

formatDateWithContext(new Date()); // "Today, 3:30 PM"
formatDateWithContext(tomorrow); // "Tomorrow, 9:00 AM"
formatDateWithContext(nextWeek); // "Monday, Jan 15 at 2:00 PM"
```

## Features in Detail

### Smart Year Selection

When parsing dates without an explicit year (like "feb 17"), the hook intelligently selects the year:
- Dates within 6 months in the future use the current year
- Dates more than 6 months in the past use the next year
- This ensures "jan 1" in December refers to next year's January

### Relevance Scoring

Results are scored based on match quality:
- Exact matches: 100
- Starts with query: 90
- Contains query: 70
- Secondary text matches: 50

Results are sorted by score, then by date proximity.

### Result Limiting

- Returns up to 15 results to keep the UI manageable
- When no query is provided, returns top 10 default presets

## Testing

The module includes comprehensive tests:

```bash
# Run all tests
bun test useDateSearch.test.ts
bun test dateParser.test.ts

# Or with vitest
bunx vitest run packages/core/component/KeyboardDatePicker/
```

## Examples

See `example-usage.tsx` for complete working examples including:
- Basic date search interface
- Keyboard navigation
- Custom base dates
- Integration patterns

## License

Internal use only.