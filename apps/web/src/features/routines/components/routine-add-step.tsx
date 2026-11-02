import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { agentStep, type StepDraft } from '../core/routine-steps';
import { SearchMenu } from './routine-search-menu';
import { useSteps } from './routine-steps';

/**
 * "+ Add step" under a routine's steps. Only Ask AI is added by hand: AI
 * writes code steps, through Draft it or a conversation about the routine.
 */
export function AddStep(props: { onAdd(step: StepDraft): void }) {
  const steps = useSteps();
  const add = (step: StepDraft) => {
    steps.fresh.add(step.id);
    props.onAdd(step);
  };
  // A routine hands off to AI once.
  const hasAgent = () => steps.steps().some((step) => step.kind === 'agent');
  return (
    <SearchMenu
      label="Add step"
      triggerVariant="ghost"
      triggerSize="sm"
      trigger={
        <>
          <PlusIcon class="size-3.5" />
          Add step
        </>
      }
      placeholder="Search steps"
      sections={
        hasAgent()
          ? []
          : [
              {
                label: 'Hand off',
                items: [
                  {
                    key: 'agent',
                    label: 'Ask AI',
                    keywords: 'agent model instructions',
                    description:
                      'Hand the rest to a model or agent with instructions. One per routine.',
                    icon: SparkleIcon,
                    ai: true,
                    hint: '1 per routine',
                    onSelect: () => add(agentStep(steps.defaultTarget())),
                  },
                ],
              },
            ]
      }
      footer={`${hasAgent() ? 'This routine already has its Ask AI step. ' : ''}Code steps are written by AI: describe what you want with Draft it, or ask AI to change the routine.`}
      width="w-72"
    />
  );
}
