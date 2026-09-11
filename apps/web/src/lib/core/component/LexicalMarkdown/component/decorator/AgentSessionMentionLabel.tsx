import {
  type SessionStatusLike,
  SessionStatusPill,
} from '@core/component/AgentSessionStatusPill';
import Robot from '@phosphor/robot.svg';
import { Show } from 'solid-js';

/** Presentational contents shared by the live decorator and browser fixture. */
export function AgentSessionMentionLabel(props: {
  label: string;
  bot?: { name: string; avatarUrl?: string | null } | null;
  status?: SessionStatusLike;
}) {
  return (
    <>
      <Show
        when={props.bot?.avatarUrl}
        fallback={<Robot class="size-4 shrink-0 text-ink-muted" />}
      >
        {(url) => (
          <img
            src={url()}
            alt=""
            class="size-4 shrink-0 rounded-full object-cover"
          />
        )}
      </Show>
      <Show when={props.bot?.name}>
        {(name) => (
          <span
            class="max-w-24 shrink-0 truncate text-ink-muted"
            title={name()}
          >
            {name()} ·
          </span>
        )}
      </Show>
      <span
        class="min-w-0 truncate underline decoration-edge-muted"
        title={props.label}
      >
        {props.label}
      </span>
      <Show when={props.status}>
        {(status) => <SessionStatusPill status={status()} />}
      </Show>
    </>
  );
}
