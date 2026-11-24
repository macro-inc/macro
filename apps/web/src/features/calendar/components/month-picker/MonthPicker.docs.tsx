import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { MonthYearPicker } from './MonthPicker';
import { MonthYearPickerPopover } from './MonthPickerPopover';

// #region demo:months
function MonthPickerDemo() {
  const [date, setDate] = createSignal(new Date(2026, 10, 13));
  const [open, setOpen] = createSignal(false);
  return (
    <MonthYearPickerPopover
      value={date()}
      open={open()}
      onOpenChange={setOpen}
      triggerSize="md"
      onChange={setDate}
      onGoToDate={setDate}
    >
      Choose month
    </MonthYearPickerPopover>
  );
}
// #endregion
// #region demo:inline
function InlineDemo() {
  const [date, setDate] = createSignal(new Date(2026, 10, 13));
  return (
    <div class="w-74 p-3">
      <MonthYearPicker
        value={date()}
        initialFocus="none"
        onChange={setDate}
        onGoToDate={setDate}
      >
        <MonthYearPicker.Header />
        <MonthYearPicker.Grid />
        <MonthYearPicker.Footer />
      </MonthYearPicker>
    </div>
  );
}
// #endregion
export default defineDoc({
  name: 'Month and year picker',
  category: 'Inputs',
  description:
    'Browse months and years without navigating; pick a month or search for a date.',
  propTypes: ['MonthYearPickerProps', 'MonthYearPickerPopoverProps'],
  guidelines: {
    do: [
      'Keep browsing separate from committing a date.',
      'Use the native date field for Go to date.',
    ],
    dont: ['Navigate the main calendar when browsing a mini calendar.'],
  },
  demos: [
    { id: 'months', title: 'Popover', render: MonthPickerDemo },
    { id: 'inline', title: 'Inline', render: InlineDemo },
  ],
});
