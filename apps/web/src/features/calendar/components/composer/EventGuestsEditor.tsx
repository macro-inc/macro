import { UserIcon } from '@core/component/UserIcon';
import { type IUser, idToEmail, recipientEntityMapper } from '@core/user';
import XIcon from '@icon/system/regular/x.svg';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button } from '@ui';
import { type Accessor, createMemo, For, type JSX, Show } from 'solid-js';
import {
  type EventEditorGuestOption,
  guestEmail,
  type SelectedEventEditorGuest,
} from './event-form-model';

export function guestDisplayName(guest: SelectedEventEditorGuest) {
  return ('name' in guest.data && guest.data.name) || guest.data.email;
}

function guestKey(guest: SelectedEventEditorGuest): string {
  return `macro|${guestEmail(guest).toLowerCase()}`;
}

function guestToUser(guest: SelectedEventEditorGuest): IUser {
  return {
    id: guestKey(guest),
    email: guestEmail(guest),
    name: guestDisplayName(guest),
  };
}

function guestFromId(
  id: string,
  options: EventEditorGuestOption[],
  known: SelectedEventEditorGuest[],
  picked: SelectedEventEditorGuest | undefined
): SelectedEventEditorGuest {
  const key = id.toLowerCase();
  const prior = known.find((guest) => guestKey(guest) === key);
  if (prior) return prior;
  if (picked && guestKey(picked) === key) return picked;
  const option = options.find((guest) => guestKey(guest) === key);
  if (option) return option;
  return recipientEntityMapper('custom')({
    id,
    email: idToEmail(id),
    invalid: false,
  });
}

/** A guest's avatar, name and address, followed by any controls. */
export function EventGuestRow(props: {
  guest: SelectedEventEditorGuest;
  children?: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-ink touch:min-h-11">
      <UserIcon
        id={props.guest.id}
        name={guestDisplayName(props.guest)}
        size="sm"
        isDeleted={false}
        suppressClick
      />
      <div class="min-w-0 flex-1 truncate text-sm">
        {guestDisplayName(props.guest)}
        <Show when={guestDisplayName(props.guest) !== guestEmail(props.guest)}>
          {/* An en space is the 0.5em gap; unlike a margin, Safari's truncated-text tooltip keeps it. */}
          {' '}
          <span class="text-ink-muted">{guestEmail(props.guest)}</span>
        </Show>
      </div>
      {props.children}
    </div>
  );
}

/**
 * The composer's guest picker: bounded personal search and scoped extras plus any typed
 * address, which joins only once its "Add" row is chosen. `excluded` guests
 * are neither offered nor toggled.
 */
export function EventGuestPicker(props: {
  /** Explicit event/host data, never a personal-directory catalog. */
  options: Accessor<EventEditorGuestOption[]>;
  selected: SelectedEventEditorGuest[];
  excluded?: SelectedEventEditorGuest[];
  onChange: (selected: SelectedEventEditorGuest[]) => void;
  onClose: () => void;
  /** Fill a sized container, such as a sheet, rather than a popover's height. */
  fillHeight?: boolean;
}) {
  const known = () => [...(props.excluded ?? []), ...props.selected];
  const users = createMemo((): IUser[] => {
    const byId = new Map<string, IUser>();
    for (const guest of [...props.options(), ...known()]) {
      byId.set(guestKey(guest), guestToUser(guest));
    }
    return [...byId.values()];
  });
  const excludedIds = createMemo(
    (): ReadonlySet<string> => new Set((props.excluded ?? []).map(guestKey))
  );
  let picked: SelectedEventEditorGuest | undefined;

  return (
    <PropertyEntitySelector
      config={{
        isMultiSelect: true,
        placeholder: 'Add guests...',
        specificEntityType: 'USER',
        additionalUsers: users,
        excludedIds,
        allowCustomEmail: true,
        fillHeight: props.fillHeight,
      }}
      selectedOptions={() => new Set(props.selected.map(guestKey))}
      onUserSelected={(user, custom) => {
        picked = custom
          ? recipientEntityMapper('custom')({
              id: user.id,
              email: user.email,
              invalid: false,
            })
          : recipientEntityMapper('user')(user);
      }}
      setSelectedOptions={(ids) => {
        const current = picked;
        picked = undefined;
        props.onChange(
          [...ids].map((id) =>
            guestFromId(id, props.options(), known(), current)
          )
        );
      }}
      onClose={props.onClose}
    />
  );
}

/**
 * Guest editing for someone who may add guests but not remove them: the
 * event's current guests are listed without a remove control, and the picker
 * only adds. Added guests can be dropped again before they are invited.
 */
export function AddOnlyGuestsEditor(props: {
  options: Accessor<EventEditorGuestOption[]>;
  current: SelectedEventEditorGuest[];
  added: SelectedEventEditorGuest[];
  onAddedChange: (added: SelectedEventEditorGuest[]) => void;
  onClose: () => void;
  /** Controls shown on each added guest, before its remove button. */
  addedControls?: (guest: SelectedEventEditorGuest) => JSX.Element;
  /** What the added people are, for assistive technology. */
  addedLabel?: string;
}) {
  return (
    <div class="flex min-h-0 flex-col">
      <EventGuestPicker
        options={props.options}
        selected={[]}
        excluded={[...props.current, ...props.added]}
        onChange={(picked) => props.onAddedChange([...props.added, ...picked])}
        onClose={props.onClose}
      />
      <div class="flex min-h-0 flex-col overflow-y-auto p-1.5">
        <Show when={props.added.length > 0}>
          <ul
            aria-label={props.addedLabel ?? 'New guests'}
            class="flex flex-col"
          >
            <For each={props.added}>
              {(guest) => (
                <li>
                  <EventGuestRow guest={guest}>
                    {props.addedControls?.(guest)}
                    <Button
                      aria-label={`Remove ${guestDisplayName(guest)}`}
                      tooltip={`Remove ${guestDisplayName(guest)}`}
                      variant="ghost"
                      size="icon-sm"
                      class="shrink-0 text-ink-muted"
                      onClick={() =>
                        props.onAddedChange(
                          props.added.filter((added) => added.id !== guest.id)
                        )
                      }
                    >
                      <XIcon class="size-3.5 shrink-0" />
                    </Button>
                  </EventGuestRow>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={props.current.length > 0}>
          <p class="px-2 pt-2 pb-1 text-xs text-ink-muted">Invited</p>
          <ul aria-label="Invited guests" class="flex flex-col">
            <For each={props.current}>
              {(guest) => (
                <li>
                  <EventGuestRow guest={guest} />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}
