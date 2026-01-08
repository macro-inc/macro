import StatusCanceled from '@macro-icons/square/task-cancelled.svg';
import StatusCreated from '@macro-icons/square/task-created.svg';
import StatusDone from '@macro-icons/square/task-done.svg';
import StatusInProgress from '@macro-icons/square/task-in-progress.svg';
import StatusInReview from '@macro-icons/square/task-in-review.svg';
import PriorityHigh from '@macro-icons/wide/priority-high.svg';
import PriorityLow from '@macro-icons/wide/priority-low.svg';
import PriorityMedium from '@macro-icons/wide/priority-medium.svg';
import PriorityUrgent from '@macro-icons/wide/priority-urgent.svg';
import { type Component, Match, Switch } from 'solid-js';
import { twMerge } from 'tailwind-merge';
import { PROPERTY_OPTION_IDS } from '../../constants';

type PropertyValueIconProps = {
  optionId: string;
  class?: string;
};

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
        <StatusCreated
          class={twMerge('size-3', props.class, 'text-ink-extra-muted')}
        />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS}>
        <StatusInProgress class={twMerge('size-3', props.class, 'text-ink')} />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.IN_REVIEW}>
        <StatusInReview
          class={twMerge('size-3', props.class, 'text-success-ink')}
        />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.COMPLETED}>
        <StatusDone class={twMerge('size-3', props.class, 'text-accent')} />
      </Match>
      <Match when={props.optionId === PROPERTY_OPTION_IDS.STATUS.CANCELED}>
        <StatusCanceled
          class={twMerge('size-3', props.class, 'text-ink-extra-muted')}
        />
      </Match>
    </Switch>
  );
};
