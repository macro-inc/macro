import ClockIcon from '@icon/system/regular/clock.svg';
import FileIcon from '@icon/system/regular/file-text.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import UserIcon from '@icon/system/regular/user.svg';
import type { TemplateVariable } from '@service-scheduled-action/generated/schemas';
import { Badge, cn } from '@ui';
import { type JSX, Match, Switch } from 'solid-js';
import type { ReferenceState } from '../core/template';

/** The name a reference shows: its label, or the time zone it keeps. */
export function variableLabel(variable: TemplateVariable): string {
  return variable.kind === 'time_zone' ? variable.timezone : variable.label;
}

function ReferenceIcon(props: { variable: TemplateVariable; class?: string }) {
  return (
    <Switch fallback={<FileIcon class={props.class} />}>
      <Match when={props.variable.kind === 'user'}>
        <UserIcon class={props.class} />
      </Match>
      <Match when={props.variable.kind === 'time_zone'}>
        <ClockIcon class={props.class} />
      </Match>
      <Match
        when={
          props.variable.kind === 'item' &&
          props.variable.block_name === 'channel'
        }
      >
        <HashIcon class={props.class} />
      </Match>
    </Switch>
  );
}

/**
 * A template reference as a badge: dashed when it fills in as the viewer,
 * amber when they can't open it, plain when it works for them as it is.
 */
export function TemplateReferenceChip(props: {
  variable: TemplateVariable;
  state: ReferenceState;
  /** Overrides the reference's own name, e.g. "you" for the author. */
  children?: JSX.Element;
}) {
  return (
    <Badge
      variant="outline"
      size="sm"
      class={cn(
        'max-w-full',
        props.state === 'fills_in' && 'border-dashed text-accent',
        props.state === 'works' && 'text-ink',
        (props.state === 'unavailable' || props.state === 'choose') &&
          'text-warning'
      )}
    >
      {props.state === 'unavailable' ? (
        <LockIcon class="shrink-0" />
      ) : (
        <ReferenceIcon variable={props.variable} class="shrink-0" />
      )}
      <span class="truncate">
        {props.children ?? variableLabel(props.variable)}
      </span>
    </Badge>
  );
}
