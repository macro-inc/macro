import { defineDoc } from '@app/features/ui-gallery/types';
import { SpeedSelector } from '@core/component/AI/component/input/SpeedSelector';
import { Model } from '@core/component/AI/constant/model';
import { speedForModel, speedsForModel } from '@core/component/AI/constant/speed';
import {
  preferredSpeed,
  setPreferredSpeed,
} from '@core/component/AI/signal/speed';
import { For } from 'solid-js';

// #region demo:speeds
function SpeedsDemo() {
  const models = [Model.gpt61Sol, Model.gpt6Astra, Model.opus55];
  return (
    <div class="flex flex-col gap-4">
      <For each={models}>
        {(model) => (
          <div class="flex h-8 items-center gap-3">
            <SpeedSelector
              offered={speedsForModel(model).map((value) => ({ value }))}
              value={speedForModel(model, preferredSpeed())}
              onChange={setPreferredSpeed}
            />
            <span class="text-sm text-ink-muted">{model}</span>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'AI priority tier',
  category: 'Inputs',
  guidelines: {
    do: [
      'Offer the tiers the selected model accepts, with each tier’s usage cost.',
    ],
    dont: ['Show the picker for a model that only runs at standard.'],
  },
  description:
    'The processing tier preference shared by AI composers. A model that does not offer the preferred tier runs at standard; the preference survives reloads.',
  demos: [
    {
      id: 'speeds',
      title: 'Tiers per model',
      render: SpeedsDemo,
    },
  ],
});
