import { onMount, Show } from 'solid-js';
import CheckIcon from '@icon/regular/check.svg';
import type { LessonContentProps, LessonDefinition } from '../types';
import { PlanGrid } from '@app/component/paywall/PlanGrid';
import type { PlanTier } from '@app/component/paywall/plans';
import { useOnboarding } from '../onboarding-context';

function ChoosePlanContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Pick the plan that matches how you want to use Macro.</p>
    </div>
  );
}

function ChoosePlanDemo(props: LessonContentProps) {
  const { selectedPlan, setSelectedPlan } = useOnboarding();

  const handleSelectPlan = (tier: PlanTier) => {
    setSelectedPlan(tier);

    if (tier === 'free') {
      props.skipLesson('team-choice');
      props.skipLesson('invite-team');
      props.skipLesson('review-pay');
    }

    props.advance();
  };

  return (
    <div class="h-full w-full flex items-center justify-center px-8">
      <PlanGrid
        footer={(plan) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectPlan(plan.tier);
            }}
            class="w-full py-2 rounded-xs text-base font-semibold flex items-center justify-center gap-1.5"
            classList={{
              'bg-accent text-panel':
                plan.highlighted && selectedPlan() !== plan.tier,
              'bg-accent/20 text-accent': selectedPlan() === plan.tier,
              'bg-ink/8 text-ink hover:bg-ink/12':
                selectedPlan() !== plan.tier && !plan.highlighted,
            }}
          >
            <Show when={selectedPlan() === plan.tier && plan.tier !== 'free'}>
              <CheckIcon class="size-4" />
            </Show>
            {plan.tier === 'free'
              ? 'Start free'
              : selectedPlan() === plan.tier
                ? 'Selected'
                : 'Select'}
          </button>
        )}
      />
    </div>
  );
}

export const choosePlanLesson: LessonDefinition = {
  id: 'choose-plan',
  title: 'Choose your plan',
  content: ChoosePlanContent,
  demo: ChoosePlanDemo,
  order: 80,
  hideContinue: true,
  completeOnParam: 'subscriptionSuccess',
};
