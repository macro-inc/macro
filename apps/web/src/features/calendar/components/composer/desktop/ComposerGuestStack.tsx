import { Avatar, AvatarGroup } from '@ui';
import { For, Show } from 'solid-js';
import { composerGuestName } from '../../../core/composer-guests';
import type { SelectedEventEditorGuest } from '../event-form-model';

export function ComposerGuestStack(props: {
  guests: SelectedEventEditorGuest[];
}) {
  return (
    <Show when={props.guests.length > 0}>
      <AvatarGroup size="sm" aria-hidden="true">
        <For each={props.guests.slice(0, 3)}>
          {(guest) => (
            <Avatar size="sm">
              <Avatar.Fallback>
                {composerGuestName(guest).slice(0, 1).toUpperCase()}
              </Avatar.Fallback>
            </Avatar>
          )}
        </For>
        <Show when={props.guests.length > 3}>
          <AvatarGroup.Count size="sm">
            +{props.guests.length - 3}
          </AvatarGroup.Count>
        </Show>
      </AvatarGroup>
    </Show>
  );
}
