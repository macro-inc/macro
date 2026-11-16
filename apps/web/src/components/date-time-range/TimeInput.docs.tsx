import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { TimeInput } from './time-input';

// #region demo:clocks
function ClockPreferenceDemo() {
  const [value, setValue] = createSignal('15:30');
  return (
    <div class="flex flex-wrap items-center gap-6">
      <label class="flex flex-col gap-2 text-sm text-ink">
        12-hour
        <TimeInput
          id="clock-twelve"
          label="12-hour time"
          value={value()}
          timeFormat="12-hour"
          onChange={(option) => setValue(option.value)}
        />
      </label>
      <label class="flex flex-col gap-2 text-sm text-ink">
        24-hour
        <TimeInput
          id="clock-twenty-four"
          label="24-hour time"
          value={value()}
          timeFormat="24-hour"
          onChange={(option) => setValue(option.value)}
        />
      </label>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Time input',
  category: 'Inputs',
  description:
    'Typed or selected local clock times with an explicit display preference.',
  guidelines: {
    do: ['Supply the calendar clock preference from the host.'],
    dont: ['Change local values when the display format changes.'],
  },
  demos: [
    {
      id: 'clocks',
      title: 'One value, two clock formats',
      render: ClockPreferenceDemo,
    },
  ],
});
