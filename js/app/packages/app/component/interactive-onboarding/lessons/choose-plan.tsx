import { onMount } from 'solid-js';
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
  const { setSelectedPlan } = useOnboarding();

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
            class="w-full py-2 rounded-xs text-base font-semibold"
            classList={{
              'bg-accent text-panel': !!plan.highlighted,
              'bg-ink/8 text-ink hover:bg-ink/12': !plan.highlighted,
            }}
          >
            {plan.tier === 'free' ? 'Start free' : 'Select'}
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
