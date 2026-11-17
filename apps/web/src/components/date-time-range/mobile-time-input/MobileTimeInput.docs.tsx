import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { endTimeOptions, type TimeOption } from '../time-options';
import { MobileTimeInput } from './MobileTimeInput';

// #region demo:start
function StartDemo() {
  const [value, setValue] = createSignal('09:00');
  return (
    <MobileTimeInput
      id="phone-start"
      label="Start time"
      timeFormat="24-hour"
      value={value()}
      onChange={(option) => setValue(option.value)}
    />
  );
}
// #endregion

// #region demo:overnight
function OvernightDemo() {
  const [selected, setSelected] = createSignal<TimeOption>();
  return (
    <MobileTimeInput
      id="phone-end"
      label="End time"
      timeFormat="12-hour"
      date="2026-11-11"
      options={endTimeOptions('20:00', '12-hour')}
      value={selected()?.value ?? '21:00'}
      selectedId={selected()?.id}
      onChange={setSelected}
    />
  );
}
// #endregion

export default defineDoc({
  name: 'MobileTimeInput',
  category: 'Inputs',
  description:
    'A keyboard-free phone time list with second-tap typing and explicit overnight date headings.',
  status: 'beta',
  import:
    "import { MobileTimeInput } from '@app/components/date-time-range/mobile-time-input/MobileTimeInput';",
  demos: [
    { id: 'start', title: '24-hour start', render: StartDemo },
    {
      id: 'overnight',
      title: 'Overnight end with durations',
      render: OvernightDemo,
    },
  ],
});
