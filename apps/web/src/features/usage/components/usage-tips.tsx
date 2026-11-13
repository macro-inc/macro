import LightbulbIcon from '@phosphor/lightbulb.svg';
import RocketLaunchIcon from '@phosphor/rocket-launch.svg';
import ScalesIcon from '@phosphor/scales.svg';
import { For, Show } from 'solid-js';
import type { UsageSummary } from '../core/usage';

type UsageTip = {
  id: string;
  title: string;
  description: string;
  icon: typeof LightbulbIcon;
};

const USAGE_TIPS: UsageTip[] = [
  {
    id: 'model-choice',
    title: 'Choose efficient models',
    description:
      'Gemini Flash 3.8 and Kimi offer strong performance at lower cost. Save frontier models for complex tasks.',
    icon: ScalesIcon,
  },
  {
    id: 'context',
    title: 'Keep context focused',
    description:
      'Shorter conversations cost less. Start fresh threads for new topics instead of extending long ones.',
    icon: LightbulbIcon,
  },
  {
    id: 'caching',
    title: 'Leverage caching',
    description:
      'Macro caches repeated content automatically. Re-asking similar questions in the same session costs less.',
    icon: RocketLaunchIcon,
  },
];

export function UsageTips(props: { summary: UsageSummary | undefined }) {
  const showTips = () =>
    props.summary &&
    !props.summary.unlimited &&
    props.summary.monthlyPercent >= 50;

  return (
    <Show when={showTips()}>
      <div class="flex flex-col gap-3">
        <h3 class="text-sm font-medium text-ink">Tips to optimize usage</h3>
        <div class="grid gap-3 @[480px]:grid-cols-3">
          <For each={USAGE_TIPS}>
            {(tip) => (
              <div class="flex flex-col gap-2 rounded-lg border border-edge-muted p-3">
                <div class="flex items-center gap-2">
                  <tip.icon class="size-4 text-accent" />
                  <span class="text-sm font-medium text-ink">{tip.title}</span>
                </div>
                <p class="text-xs text-ink-muted leading-relaxed">
                  {tip.description}
                </p>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
