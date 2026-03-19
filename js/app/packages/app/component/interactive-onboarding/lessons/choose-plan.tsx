import { onMount, For } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

const PLANS: {
  name: string;
  price: number;
  description: string;
  calls: string;
  popular?: boolean;
}[] = [
  {
    name: 'Haiku',
    price: 20,
    description: "Access to Anthropic's fast, lightweight model",
    calls: '1,000',
  },
  {
    name: 'Sonnet',
    price: 60,
    description: "Access to Anthropic's balanced frontier model",
    calls: '5,000',
    popular: true,
  },
  {
    name: 'Opus',
    price: 120,
    description: "Access to Anthropic's most capable model",
    calls: 'Unlimited',
  },
];

function ChoosePlanContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Pick the plan that works best for your team.</p>
    </div>
  );
}

function ChoosePlanDemo() {
  return (
    <div class="h-full w-full flex items-center justify-center px-8">
      <div class="flex gap-4 w-full max-w-2xl">
        <For each={PLANS}>
          {(plan) => (
            <div
              class="flex-1 rounded-sm border bg-panel flex flex-col overflow-hidden"
              classList={{
                'border-accent ring-1 ring-accent': !!plan.popular,
                'border-edge-muted': !plan.popular,
              }}
            >
              {plan.popular && (
                <div class="bg-accent text-panel text-[10px] font-semibold text-center py-0.5">
                  Most popular
                </div>
              )}
              <div class="p-4 flex flex-col gap-3 flex-1">
                <div>
                  <h3 class="text-lg font-semibold text-ink">{plan.name}</h3>
                  <p class="text-xs text-ink/50 mt-0.5">{plan.description}</p>
                </div>
                <div class="flex items-baseline gap-0.5">
                  <span class="text-3xl font-bold text-ink">${plan.price}</span>
                  <span class="text-sm text-ink/40">/mo</span>
                </div>
                <div class="text-xs text-ink/60">
                  <span class="font-semibold text-ink">{plan.calls}</span> AI
                  tool calls per month
                </div>
                <div class="mt-auto pt-2">
                  <button
                    type="button"
                    class="w-full py-2 rounded-xs text-sm font-semibold"
                    classList={{
                      'bg-accent text-panel': !!plan.popular,
                      'bg-ink/8 text-ink hover:bg-ink/12': !plan.popular,
                    }}
                  >
                    Get {plan.name}
                  </button>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export const choosePlanLesson: LessonDefinition = {
  id: 'choose-plan',
  title: 'Choose your plan',
  content: ChoosePlanContent,
  demo: ChoosePlanDemo,
  order: 80,
};
