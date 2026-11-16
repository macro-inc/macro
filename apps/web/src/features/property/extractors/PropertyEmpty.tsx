import NoDueDateIcon from '@icon/system/regular/calendar-slash.svg';
import CircleDashedEmpty from '@icon/system/regular/circle-dashed.svg';
import ProjectIcon from '@icon/system/regular/cube-dashed.svg';
import SourceIcon from '@icon/system/regular/link.svg';
import PersonIcon from '@icon/system/regular/user-circle-dashed.svg';
import PriorityNoneIcon from '@icon/wide-priority-none.svg';
import { cn } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../constants';

export function PropertyEmptyIcon(props: {
  propertyDefinitionId?: string;
  class?: string;
  /** Dim empty glyphs without dimming intrinsically muted artwork twice. */
  muted?: boolean;
}) {
  return (
    <span
      class={cn('inline-flex size-3 shrink-0', props.class)}
      aria-hidden="true"
    >
      <Switch
        fallback={
          <CircleDashedEmpty
            class={cn('size-full', props.muted && 'opacity-50')}
          />
        }
      >
        <Match when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.SOURCE}>
          <SourceIcon class={cn('size-full', props.muted && 'opacity-50')} />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.DUE_DATE}
        >
          <NoDueDateIcon class={cn('size-full', props.muted && 'opacity-50')} />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY}
        >
          <PriorityNoneIcon class="size-full text-ink-extra-muted" />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT}
        >
          <ProjectIcon class={cn('size-full', props.muted && 'opacity-50')} />
        </Match>
        <Match
          when={props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES}
        >
          <PersonIcon class={cn('size-full', props.muted && 'opacity-50')} />
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
  iconClass?: string;
};

/**
 * Standard empty-value affordance with an optional label.
 */
export function PropertyEmpty(props: Props) {
  return (
    <span class={cn('inline-flex items-center gap-1.5', props.class)}>
      <Show when={!props.hideIcon}>
        <PropertyEmptyIcon
          muted
          propertyDefinitionId={props.propertyDefinitionId}
          class={props.iconClass}
        />
      </Show>
      <Show when={props.label}>
        <span class="truncate opacity-50">{props.label}</span>
      </Show>
    </span>
  );
}
