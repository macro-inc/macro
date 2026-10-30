import CircleDashedEmpty from '@icon/system/regular/circle-dashed.svg';
import ProjectIcon from '@icon/system/regular/cube-dashed.svg';
import PersonIcon from '@icon/system/regular/user-circle-dashed.svg';
import PriorityNoneIcon from '@icon/wide-priority-none.svg';
import { cn } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../constants';

export function PropertyEmptyIcon(props: {
  propertyDefinitionId?: string;
  class?: string;
}) {
  return (
    <span
      class={cn('inline-flex size-3 shrink-0', props.class)}
      aria-hidden="true"
      data-icon-motion="none"
    >
      <Switch fallback={<CircleDashedEmpty class="size-full" />}>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY}
        >
          <PriorityNoneIcon class="size-full text-ink-extra-muted" />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT}
        >
          <ProjectIcon class="size-full" />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES}
        >
          <PersonIcon class="size-full" />
        </Match>
      </Switch>
    </span>
  );
}

type Props = {
  propertyDefinitionId?: string;
  /** Text to render after the empty icon (e.g. "None", "Set status"). */
  label?: JSX.Element;
  /** Hide the icon (text-only empty state). */
  hideIcon?: boolean;
  class?: string;
};

/**
 * Standard empty-value affordance with an optional label.
 */
export function PropertyEmpty(props: Props) {
  return (
    <span
      class={cn(
        'inline-flex items-center gap-1.5',
        props.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.PRIORITY &&
          'opacity-50',
        props.class
      )}
    >
      <Show when={!props.hideIcon}>
        <PropertyEmptyIcon propertyDefinitionId={props.propertyDefinitionId} />
      </Show>
      <Show when={props.label}>
        <span
          class={cn(
            'truncate',
            props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY &&
              'opacity-50'
          )}
        >
          {props.label}
        </span>
      </Show>
    </span>
  );
}
