import ArrowsSplitIcon from '@phosphor/arrows-split.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import PlusIcon from '@phosphor/plus.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
  stepActionGroups,
} from '../core/step-catalog';
import { actionIcon, useSteps } from './routine-steps';
import { menuMount } from './routine-tool-step';

function MenuHint(props: { children: JSX.Element }) {
  return (
    <p class="max-w-64 px-2 pb-1.5 text-xs text-ink-muted">{props.children}</p>
  );
}

export function AddStep(props: {
  /** `list` closes a step list; `chip` sits among a rule's steps. */
  variant: 'list' | 'chip';
  title?: string;
  scope: StepScope;
  onAdd(step: StepDraft): void;
}) {
  const steps = useSteps();
  const actions = () => availableActions(props.scope);
  const add = (step: StepDraft) => {
    steps.fresh.add(step.id);
    props.onAdd(step);
  };
  let trigger: HTMLButtonElement | undefined;
  return (
    <Dropdown placement="bottom-start">
      <Show
        when={props.variant === 'chip'}
        fallback={
          <Dropdown.Trigger
            ref={trigger}
            variant="ghost"
            size="sm"
            class="w-fit gap-1.5 text-ink-muted"
            aria-label="Add step"
          >
            <PlusIcon class="size-3.5" />
            Add step
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          ref={trigger}
          variant="ghost"
          size="icon-sm"
          class="size-7 shrink-0 border border-dashed border-edge text-ink-muted"
          aria-label="Add step to branch"
          title={props.title ?? 'Add a step'}
        >
          <PlusIcon class="size-3" />
        </Dropdown.Trigger>
      </Show>
      <Dropdown.Content
        portalScope="local"
        mount={menuMount(trigger)}
        class="max-h-[min(32rem,var(--kb-popper-content-available-height))] min-w-56 overflow-y-auto overscroll-contain"
      >
        <For each={stepActionGroups}>
          {(group) => (
            <Show when={actions().some((action) => action.group === group)}>
              <Dropdown.Group>
                <Dropdown.GroupLabel>{group}</Dropdown.GroupLabel>
                <For
                  each={actions().filter((action) => action.group === group)}
                >
                  {(action) => (
                    <Dropdown.Item
                      title={action.description}
                      onSelect={() =>
                        add(
                          createActionStep(action, props.scope, steps.steps())
                        )
                      }
                    >
                      <Dynamic
                        component={actionIcon(action.key)}
                        class="size-4"
                      />
                      {action.label}
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Show>
          )}
        </For>
        <Show when={!actions().some((action) => action.group === 'Item')}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Item</Dropdown.GroupLabel>
            <MenuHint>
              Tag, assign, comment and move need an activity trigger or a task
              created by an earlier step.
            </MenuHint>
          </Dropdown.Group>
        </Show>
        <Show when={steps.decisions() !== 'off'}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Let AI decide</Dropdown.GroupLabel>
            <Show
              when={steps.decisions() === 'on'}
              fallback={
                <MenuHint>
                  Needs an activity trigger, like a new email or task.
                </MenuHint>
              }
            >
              <For each={availablePicks(props.scope)}>
                {(pick) => (
                  <Dropdown.Item
                    title={pick.description}
                    onSelect={() => add(createPickStep(pick, props.scope))}
                  >
                    <Dynamic
                      component={actionIcon(pick.action)}
                      class="size-4"
                    />
                    {pick.label}
                  </Dropdown.Item>
                )}
              </For>
              <Dropdown.Item onSelect={() => add(ifStep())}>
                <GitBranchIcon class="size-4" />
                If yes or no
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => add(chooseStep())}>
                <ArrowsSplitIcon class="size-4" />
                Choose between options
              </Dropdown.Item>
            </Show>
          </Dropdown.Group>
        </Show>
        <Dropdown.Group>
          <Dropdown.GroupLabel>AI</Dropdown.GroupLabel>
          <Dropdown.Item onSelect={() => add(agentStep(steps.defaultTarget()))}>
            <SparkleIcon class="size-4" />
            Ask AI
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
