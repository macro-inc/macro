import CircleDashedEmpty from '@icon/system/regular/circle-dashed.svg';
import MinusIcon from '@icon/system/regular/minus.svg';
import ProjectIcon from '@icon/system/regular/stack.svg';
import PersonIcon from '@icon/system/regular/user.svg';
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
          <MinusIcon class="size-full" />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT}
        >
          <ProjectIcon class="size-full" stroke-dasharray="3 4" />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES}
        >
          <PersonIcon class="size-full" stroke-dasharray="3 3" />
        </Match>
      </Switch>
    </span>
  );
}

type Props = {
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
      class={cn('inline-flex items-center gap-1.5 opacity-50', props.class)}
    >
      <Show when={!props.hideIcon}>
        <PropertyEmptyIcon />
      </Show>
      <Show when={props.label}>
        <span class="truncate">{props.label}</span>
      </Show>
    </span>
  );
}
