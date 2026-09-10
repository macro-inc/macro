import StatusCanceled from '@icon/square-task-cancelled-circle.svg';
import StatusCreated from '@icon/square-task-created-circle.svg';
import StatusDone from '@icon/square-task-done-circle.svg';
import StatusInProgress from '@icon/square-task-in-progress-circle.svg';
import StatusInReview from '@icon/square-task-in-review-circle.svg';
import PriorityHigh from '@icon/wide-priority-high.svg';
import PriorityLow from '@icon/wide-priority-low.svg';
import PriorityMedium from '@icon/wide-priority-medium.svg';
import PriorityUrgent from '@icon/wide-priority-urgent.svg';
import { type Component, Match, Switch } from 'solid-js';
import { twMerge } from 'tailwind-merge';
import { PROPERTY_OPTION_IDS } from '../../constants';

type PropertyValueIconProps = {
  optionId: string;
  class?: string;
};

/** Filled dot used for CRM stage options — colored via `currentColor`. */
const StageDot: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 0 12 12" class={props.class} aria-hidden="true">
    <circle cx="6" cy="6" r="4" fill="currentColor" />
  </svg>
);

const STAGE_DOT_TINTS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.STAGE.LEAD]: 'text-ink-muted',
  [PROPERTY_OPTION_IDS.STAGE.QUALIFIED]: 'text-task',
  [PROPERTY_OPTION_IDS.STAGE.DEMO]: 'text-note',
  [PROPERTY_OPTION_IDS.STAGE.TRIAL]: 'text-alert-ink',
  [PROPERTY_OPTION_IDS.STAGE.NEGOTIATION]: 'text-accent',
  [PROPERTY_OPTION_IDS.STAGE.CUSTOMER]: 'text-success',
  [PROPERTY_OPTION_IDS.STAGE.CHURNED]: 'text-failure-ink',
};

const knownPropertyIds = new Set<string>(
  Object.values(PROPERTY_OPTION_IDS).flatMap((group) => Object.values(group))
);

/**
 * Render appropriate icons for property option values - based on common,
 * hard-coded property option ids.
 *
 * @example
 * ```tsx
 * <PropertyValueIcon
 *   optionId={PROPERTY_OPTION_IDS.PRIORITY.HIGH}
 * />
 * ```
 */
export const PropertyValueIcon: Component<PropertyValueIconProps> = (props) => {
  if (!knownPropertyIds.has(props.optionId)) {
    return null;
  }
  return (
    <Switch>
      {/* Priority */}
      <Match when={props.optionId === PROPERTY_OPTION_IDS.PRIORITY.LOW}>
        <PriorityLow
          class={twMerge('size-3', props.class, 'text-ink-extra-muted')}
        />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.PRIORITY.MEDIUM}>
        <PriorityMedium
          class={twMerge('size-3', props.class, 'text-ink-extra-muted')}
        />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.PRIORITY.HIGH}>
        <PriorityHigh
          class={twMerge('size-3', props.class, 'text-ink-extra-muted')}
        />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.PRIORITY.URGENT}>
        <PriorityUrgent class={twMerge('size-3', props.class, 'text-accent')} />
      </Match>

      {/* Status */}
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.NOT_STARTED}>
        <StatusCreated class={twMerge('size-3', props.class, 'text-task')} />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS}>
        <StatusInProgress
          class={twMerge('size-3', props.class, 'text-warning')}
        />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.IN_REVIEW}>
        <StatusInReview class={twMerge('size-3', props.class, 'text-note')} />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.COMPLETED}>
        <StatusDone class={twMerge('size-3', props.class, 'text-accent')} />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.CANCELED}>
        <StatusCanceled
          class={twMerge('size-3', props.class, 'text-ink-muted')}
        />
      </Match>

      {/* CRM stage */}
      <Match when={STAGE_DOT_TINTS[props.optionId]}>
        {(tint) => <StageDot class={twMerge('size-3', props.class, tint())} />}
      </Match>
    </Switch>
  );
};
