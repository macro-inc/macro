import GitBranchIcon from '@icon/system/regular/git-branch.svg';
import GitForkIcon from '@icon/system/regular/git-fork.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Show } from 'solid-js';
import {
  agentStep,
  chooseStep,
  ifStep,
  type StepDraft,
} from '../core/routine-steps';
import {
  availableActions,
  availablePicks,
  createActionStep,
  createPickStep,
  type StepScope,
  stepActionGroupLabels,
  stepActionGroups,
} from '../core/step-catalog';
import { SearchMenu, type SearchMenuSection } from './routine-search-menu';
import { actionIcon, useSteps } from './routine-steps';

/**
 * The menu of every step that fits here: plain actions first, since they are
 * exact and free, then steps where AI decides, then handing off to an agent.
 */
export function AddStep(props: {
  /** `step` is the dashed "+ Step"; `icon` a small + beside a choice's row. */
  variant?: 'step' | 'icon';
  /** Names where the step goes, e.g. a branch, for its accessible name. */
  place?: string;
  scope: StepScope;
  onAdd(step: StepDraft): void;
}) {
  const steps = useSteps();
  const add = (step: StepDraft) => {
    steps.fresh.add(step.id);
    props.onAdd(step);
  };
  const sections = (): SearchMenuSection[] => {
    const actions = availableActions(props.scope);
    const plain = stepActionGroups.map((group) => ({
      label: stepActionGroupLabels[group],
      items: actions
        .filter((action) => action.group === group)
        .map((action) => ({
          key: action.key,
          label: action.menuLabel ?? action.label,
          description: action.description,
          icon: actionIcon(action.key),
          onSelect: () =>
            add(createActionStep(action, props.scope, steps.steps())),
        })),
    }));
    const decide =
      steps.decisions() === 'on'
        ? [
            {
              label: 'Let AI decide',
              items: [
                ...availablePicks(props.scope).map((pick) => ({
                  key: pick.label,
                  label: pick.label,
                  description: pick.description,
                  icon: SparkleIcon,
                  ai: true,
                  onSelect: () => add(createPickStep(pick, props.scope)),
                })),
                {
                  key: 'if',
                  label: 'If yes or no',
                  keywords: 'condition question branch',
                  description: 'Ask AI a yes/no question and branch on it.',
                  icon: GitBranchIcon,
                  ai: true,
                  onSelect: () => add(ifStep()),
                },
                {
                  key: 'choose',
                  label: 'Choose between options',
                  keywords: 'classify route branch',
                  description: 'AI picks the option that fits.',
                  icon: GitForkIcon,
                  ai: true,
                  onSelect: () => add(chooseStep()),
                },
              ],
            },
          ]
        : [];
    return [
      ...plain,
      ...decide,
      {
        label: 'Hand off',
        items: [
          {
            key: 'agent',
            label: 'Ask AI',
            keywords: 'agent model instructions',
            description:
              'Hand the rest to a model or agent with instructions. One per run.',
            icon: SparkleIcon,
            ai: true,
            hint: '1 per run',
            onSelect: () => add(agentStep(steps.defaultTarget())),
          },
        ],
      },
    ];
  };
  // Why some steps are missing here, if they are.
  const note = () => {
    if (steps.decisions() === 'needs-event')
      return 'AI decisions need an activity trigger, like a new email or task.';
    if (
      !availableActions(props.scope).some((action) => action.group === 'Item')
    )
      return 'Status, priority, assign and comment show up once a task is in play: a task trigger, or a Create task step above.';
    return undefined;
  };
  return (
    <SearchMenu
      label={props.place ? `Add step to ${props.place}` : 'Add step'}
      title={props.variant === 'icon' ? 'Also do something' : undefined}
      triggerVariant={props.variant === 'icon' ? 'ghost' : 'outline'}
      triggerSize={props.variant === 'icon' ? 'icon-sm' : 'sm'}
      triggerClass={
        props.variant === 'icon' ? undefined : 'w-fit border-dashed'
      }
      trigger={
        <>
          <PlusIcon class="size-3.5" />
          <Show when={props.variant !== 'icon'}>Step</Show>
        </>
      }
      placeholder="Search steps"
      sections={sections()}
      footer={note()}
      width="w-72"
    />
  );
}
