import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { CalendarRange, type CalendarRangeProps } from './CalendarRange';

// #region demo:range
function RangeDemo() {
  const [value, setValue] = createSignal<CalendarRangeProps['value']>({
    from: new Date(2026, 10, 12),
    to: new Date(2026, 10, 16),
  });
  return (
    <div class="w-72">
      <CalendarRange
        required
        fixedWeeks
        value={value()}
        onValueChange={setValue}
      />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'CalendarRange',
  category: 'Inputs',
  description:
    'An inclusive date range using the shared calendar grid and native keyboard navigation. Pick a start, then an end.',
  status: 'stable',
  exports: ['CalendarRange'],
  import:
    "import { CalendarRange } from '@ui/components/calendar-range/CalendarRange';",
  demos: [{ id: 'range', title: 'Two-click range', render: RangeDemo }],
});
