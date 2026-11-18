/**
 * The other editors on a question or section, as the app shows people
 * elsewhere: their avatars, ringed in the color their cursor has.
 */
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import { AvatarGroup } from '@ui';
import { For } from 'solid-js';
import type { EditorsProps } from './context/form-context';

const nameOf = (userId: string | undefined) =>
  getDisplayName(tryMacroId(userId ?? ''), { emailFallback: 'local-part' }) ||
  'Someone';

export function FormEditors(props: EditorsProps) {
  const names = () =>
    new Intl.ListFormat(undefined, { type: 'conjunction' }).format(
      props.peers.map((peer) => nameOf(peer.userId))
    );
  return (
    <AvatarGroup
      size="sm"
      role="group"
      aria-label={`${names()} ${props.peers.length === 1 ? 'is' : 'are'} on ${props.selected}`}
    >
      <For each={props.peers}>
        {(peer) => (
          <span
            class="flex"
            style={{
              '--avatar-group-separator': `var(--color-${peer.color}, var(--color-accent))`,
            }}
          >
            <UserIcon
              id={peer.userId ?? ''}
              size="sm"
              showTooltip
              suppressClick
            />
          </span>
        )}
      </For>
    </AvatarGroup>
  );
}

/** A person as the app shows people: their avatar and name. */
export function FormPerson(props: { userId: string }) {
  return (
    <span class="flex min-w-0 items-center gap-1.5">
      <UserIcon id={props.userId} size="sm" suppressClick />
      <span class="truncate">{nameOf(props.userId)}</span>
    </span>
  );
}
