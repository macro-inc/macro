import User from '@phosphor/user.svg';
import Users from '@phosphor/users.svg';
import { Badge } from '@ui';
import { Show } from 'solid-js';
import type { SchedulingScope } from '../core/types';

export function OwnerBadge(props: { scope: SchedulingScope }) {
  return (
    <Badge
      variant="outline"
      size="sm"
      class="max-w-full font-normal"
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
    </Badge>
  );
}
