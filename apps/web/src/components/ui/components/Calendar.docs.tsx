import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { Calendar } from './Calendar';

// #region demo:plain
function PlainDemo() {
  const [date, setDate] = createSignal(new Date(2026, 10, 12));
  return (
    <div class="w-64">
      <Calendar
        required
        fixedWeeks
        value={date()}
        onValueChange={(day) => day && setDate(day)}
      />
    </div>
  );
}
// #endregion

// #region demo:markers
function MarkersDemo() {
  const [date, setDate] = createSignal(new Date(2026, 10, 12));
  const markers = new Map([
    ['2026-11-03', ['var(--color-blue-ink)']],
    ['2026-11-08', ['var(--color-green-ink)', 'var(--color-violet-ink)']],
    [
      '2026-11-12',
      [
        'var(--color-blue-ink)',
        'var(--color-violet-ink)',
        'var(--color-green-ink)',
      ],
    ],
    [
      '2026-11-18',
      [
        'var(--color-blue-ink)',
        'var(--color-violet-ink)',
        'var(--color-green-ink)',
        'var(--color-amber-ink)',
      ],
    ],
  ]);
  return (
    <div class="w-64">
      <Calendar
        required
        fixedWeeks
        value={date()}
        highlightedRange={{
          start: new Date(2026, 10, 9),
          end: new Date(2026, 10, 16),
        }}
        markersByDay={markers}
        onValueChange={(day) => day && setDate(day)}
      />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Calendar',
  category: 'Inputs',
  description:
    'Single-date calendar with optional local-day event colors and end-exclusive week highlighting.',
  status: 'stable',
  exports: ['Calendar'],
  import: "import { Calendar } from '@ui';",
  demos: [
    { id: 'plain', title: 'Without markers', render: PlainDemo },
    {
      id: 'markers',
      title: 'One to three dots and a multicolor bar',
      render: MarkersDemo,
    },
  ],
});
