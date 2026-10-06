import User from '@phosphor/user.svg';
import Users from '@phosphor/users.svg';
import { Show } from 'solid-js';
import type { SchedulingScope } from '../core/types';

export function OwnerBadge(props: { scope: SchedulingScope }) {
  return (
    <span
      class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-ink/5 px-2 py-1 text-xs font-normal text-ink-muted"
      title={props.scope.teamId ? `Team · ${props.scope.name}` : 'Personal'}
    >
      <Show
        when={props.scope.teamId}
        fallback={<User class="size-3 shrink-0" />}
      >
        <Users class="size-3 shrink-0" />
      </Show>
      <span class="truncate">
        {props.scope.teamId ? `Team · ${props.scope.name}` : 'Personal'}
      </span>
    </span>
  );
}
