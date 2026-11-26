import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { SheetGroup } from '../SheetGroup';
import { WheelColumn, WheelPicker } from './WheelPicker';

const MINUTES = Array.from({ length: 12 }, (_, index) => ({
  value: String(index * 5),
  label: String(index * 5).padStart(2, '0'),
}));

// #region demo:minute
function WheelDemo() {
  const [minute, setMinute] = createSignal('30');
  return (
    <SheetGroup class="w-[334px] max-w-full">
      <WheelPicker label="Minute picker">
        <WheelColumn
          label="Minute"
          width={64}
          options={MINUTES}
          value={minute()}
          onChange={setMinute}
          loop
        />
      </WheelPicker>
    </SheetGroup>
  );
}
// #endregion

export default defineDoc({
  name: 'Wheel picker',
  category: 'Inputs',
  description:
    'Native momentum columns with snap selection and keyboard navigation.',
  guidelines: {
    do: [
      'Use localized labels and controlled values.',
      'Use bounded columns unless values are cyclical.',
    ],
    dont: ['Nest another sheet for inline clock columns.'],
  },
  demos: [{ id: 'minute', title: 'Looping minute column', render: WheelDemo }],
});
