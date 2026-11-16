import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { MonthPickerPopover } from './MonthPickerPopover';

// #region demo:months
function MonthPickerDemo() {
  const [date, setDate] = createSignal(new Date(2026, 10, 13));
  const [open, setOpen] = createSignal(false);
  return (
    <MonthPickerPopover
      date={date()}
      open={open()}
      onOpenChange={setOpen}
      onSelect={(date) => {
        setDate(date);
        setOpen(false);
      }}
    />
  );
}
// #endregion

export default defineDoc({
  name: 'Month picker',
  category: 'Inputs',
  description:
    'Browse a year without navigating, then pick a month or enter a local date.',
  propTypes: ['MonthPickerProps', 'MonthPickerPopoverProps'],
  demos: [
    {
      id: 'months',
      title: 'Month and year navigation',
      render: MonthPickerDemo,
    },
  ],
});
