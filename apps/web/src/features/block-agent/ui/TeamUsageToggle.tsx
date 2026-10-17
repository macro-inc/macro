/**
 * The composer's choice between Macro usage and the team's own API key, for
 * sessions whose owner's team has registered one. On, it reads as a small
 * "Using team API usage" indicator; off, it is a key icon that turns it on.
 */

import KeyIcon from '@phosphor/key.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';

export const TEAM_USAGE_LABEL = 'Using team API usage';

export function TeamUsageToggle(props: {
  on: boolean;
  disabled?: boolean;
  onToggle: (on: boolean) => void;
}) {
  const label = () =>
    props.on
      ? `${TEAM_USAGE_LABEL} · switch back to Macro usage`
      : "Use your team's API key for AI chat";
  return (
    <Button
      variant="ghost"
      size={props.on ? 'xs' : 'icon-composer'}
      label={label()}
      aria-label={label()}
      aria-pressed={props.on}
      disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onToggle(!props.on)}
      class={cn(
        'shrink-0',
        props.on ? 'text-accent bg-accent/10' : 'text-ink-muted'
      )}
    >
      <KeyIcon class={props.on ? 'size-3' : 'size-4'} />
      <Show when={props.on}>
        <span>{TEAM_USAGE_LABEL}</span>
      </Show>
    </Button>
  );
}
