import { defineDoc } from '@app/features/ui-gallery/types';
import { BusyIndicator } from './BusyIndicator';

// #region demo:availability
function BusyIndicatorDemo() {
  return (
    <div class="flex flex-col gap-3 text-sm text-ink">
      <span class="flex items-center gap-2">
        Confirmed conflict <BusyIndicator busy />
      </span>
      <span class="flex items-center gap-2">
        Confirmed free <BusyIndicator busy={false} />
      </span>
      <span class="flex items-center gap-2">
        Unknown availability <BusyIndicator />
      </span>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Busy indicator',
  category: 'Data Display',
  description:
    'A confirmed availability conflict; unknown and free have no badge.',
  propTypes: ['BusyIndicatorProps'],
  demos: [
    {
      id: 'availability',
      title: 'Known and unknown availability',
      render: BusyIndicatorDemo,
    },
  ],
});
