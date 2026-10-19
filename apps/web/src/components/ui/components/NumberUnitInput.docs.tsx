import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { NumberUnitInput } from './NumberUnitInput';

// #region demo:amounts
function AmountsDemo() {
  const [minutes, setMinutes] = createSignal('30');
  return (
    <div class="flex flex-wrap items-center gap-3">
      <NumberUnitInput
        value={minutes()}
        onChange={setMinutes}
        minValue={0}
        maxValue={60}
        format={false}
      >
        <NumberUnitInput.Controls align="inline-start">
          <NumberUnitInput.DecrementTrigger label="Decrease duration" />
        </NumberUnitInput.Controls>
        <NumberUnitInput.Frame>
          <NumberUnitInput.Input aria-label="Duration" />
          <NumberUnitInput.Unit>min</NumberUnitInput.Unit>
        </NumberUnitInput.Frame>
        <NumberUnitInput.Controls align="inline-end">
          <NumberUnitInput.IncrementTrigger label="Increase duration" />
        </NumberUnitInput.Controls>
      </NumberUnitInput>
      <NumberUnitInput defaultValue={1} step={0.01}>
        <NumberUnitInput.Frame>
          <NumberUnitInput.Input aria-label="Notice" />
          <NumberUnitInput.Unit>hour</NumberUnitInput.Unit>
        </NumberUnitInput.Frame>
      </NumberUnitInput>
      <NumberUnitInput defaultValue={30} disabled>
        <NumberUnitInput.Frame>
          <NumberUnitInput.Input aria-label="Disabled window" />
          <NumberUnitInput.Unit>days</NumberUnitInput.Unit>
        </NumberUnitInput.Frame>
      </NumberUnitInput>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'NumberUnitInput',
  category: 'Inputs',
  description:
    'Composes Kobalte NumberField with InputGroup framing, a unit label, and optional decrement/increment controls. Conversion and unit selection belong to the caller.',
  status: 'stable',
  exports: ['NumberUnitInput'],
  import: "import { NumberUnitInput } from '@ui';",
  demos: [
    {
      id: 'amounts',
      title: 'Numbers with units and optional controls',
      description:
        'Kobalte handles keyboard stepping, bounds, and button focus. Frame contains the number and unit; compose standalone Controls and triggers on either side, outside the frame. Inputs use a taller shared frame and readable units. Wheel changes are off by default.',
      render: AmountsDemo,
    },
  ],
});
