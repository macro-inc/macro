import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { DatePicker } from './DatePicker';

// #region demo:basic
function BasicDemo() {
  const [date, setDate] = createSignal('');
  return (
    <div class="w-64">
      <DatePicker aria-label="Date" value={date()} onChange={setDate} />
    </div>
  );
}
// #endregion

// #region demo:bounds
function BoundsDemo() {
  const [date, setDate] = createSignal('2026-10-15');
  return (
    <div class="flex w-64 flex-col gap-2">
      <span class="text-sm text-ink-muted">October 10–20, 2026</span>
      <DatePicker
        aria-label="Appointment date"
        value={date()}
        onChange={setDate}
        min="2026-10-10"
        max="2026-10-20"
        required
      />
    </div>
  );
}
// #endregion

// #region demo:disabled
function DisabledDemo() {
  return (
    <div class="w-64">
      <DatePicker
        aria-label="Locked date"
        value="2026-10-15"
        onChange={() => {}}
        disabled
      />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'DatePicker',
  category: 'Inputs',
  description:
    'A date-only selector that combines the shared Calendar with a keyboard-accessible popover. Values stay in YYYY-MM-DD format.',
  status: 'stable',
  exports: ['DatePicker'],
  import: "import { DatePicker } from '@ui';",
  demos: [
    {
      id: 'basic',
      title: 'Optional date',
      description:
        'Select a day, jump to today, or clear the field. Escape dismisses without changing the selected date.',
      render: BasicDemo,
    },
    {
      id: 'bounds',
      title: 'Required date with limits',
      description:
        'Inclusive minimum and maximum dates disable unavailable days. Required dates cannot be cleared.',
      render: BoundsDemo,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: DisabledDemo,
    },
  ],
});
