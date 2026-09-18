import { Avatar } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { CalendarCallPerson } from '../core/calendar-calls';

export type CallAvatarRenderer = (person: CalendarCallPerson) => JSX.Element;

export function CalendarPersonAvatar(props: {
  person: CalendarCallPerson;
  renderAvatar?: CallAvatarRenderer;
}) {
  const name = () => props.person.name ?? props.person.email;
  return (
    <Show
      when={props.renderAvatar}
      fallback={
        <Avatar size="sm" class="size-7 shrink-0" aria-label={name()}>
          <Show when={props.person.photoUrl}>
            {(src) => <Avatar.Image src={src()} alt={name()} />}
          </Show>
          <Avatar.Fallback>
            {name()
              .split(/[\s.@_-]+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase()}
          </Avatar.Fallback>
        </Avatar>
      }
    >
      {(render) => render()(props.person)}
    </Show>
  );
}
