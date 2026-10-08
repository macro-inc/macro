import { defineDoc } from '@app/features/ui-gallery/types';
import { SpeedToggle } from '@core/component/AI/component/input/SpeedToggle';
import { Model } from '@core/component/AI/constant/model';

// #region demo:speeds
function SpeedsDemo() {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <SpeedToggle model={Model.gpt6Astra} /> GPT-6 Astra · 6×
      </div>
      <div class="flex items-center gap-3">
        <SpeedToggle model={Model.gpt61Sol} /> GPT-6.1 Sol · 6×
      </div>
      <div class="flex items-center gap-3">
        <SpeedToggle model={Model.opus55} /> Opus 5.5 · 2×
      </div>
      <div class="flex items-center gap-3">
        <SpeedToggle model={Model.sonnet55} /> Sonnet 5.5 · standard only
      </div>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'AI speed toggle',
  category: 'Inputs',
  description:
    'A persistent, explicit paid-speed preference shared by chat composers. Click a bolt to preview the animation; the preference survives reloads.',
  demos: [
    {
      id: 'speeds',
      title: 'Model speed support',
      render: SpeedsDemo,
    },
  ],
});
