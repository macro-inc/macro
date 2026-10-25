import { UserIcon } from '@core/component/UserIcon';
import { type IUser, idToEmail, recipientEntityMapper } from '@core/user';
import XIcon from '@phosphor/x.svg';
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

function guestToUser(guest: SelectedEventEditorGuest): IUser {
  return {
    id: guest.id,
    email: guestEmail(guest),
    name: guestDisplayName(guest),
  };
}

function guestFromId(
  id: string,
  options: EventEditorGuestOption[],
  known: SelectedEventEditorGuest[]
): SelectedEventEditorGuest {
  const option = options.find((guest) => guest.id === id);
  if (option) return option;
  const prior = known.find((guest) => guest.id === id);
  if (prior) return prior;
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
      <UserIcon id={props.guest.id} size="sm" isDeleted={false} suppressClick />
      <div class="min-w-0 flex-1 truncate text-sm">
        {guestDisplayName(props.guest)}
        <Show when={guestDisplayName(props.guest) !== guestEmail(props.guest)}>
          <span class="ml-[0.5em] text-ink-muted">
            {guestEmail(props.guest)}
          </span>
        </Show>
      </div>
      {props.children}
    </div>
  );
}

/**
 * The composer's guest picker: team and contact suggestions plus any typed
 * address, which joins only once its "Add" row is chosen. `excluded` guests
 * are neither offered nor toggled.
 */
export function EventGuestPicker(props: {
  options: Accessor<EventEditorGuestOption[]>;
  selected: SelectedEventEditorGuest[];
  excluded?: SelectedEventEditorGuest[];
  onChange: (selected: SelectedEventEditorGuest[]) => void;
  onClose: () => void;
}) {
  const known = () => [...(props.excluded ?? []), ...props.selected];
  const users = createMemo((): IUser[] => {
    const byId = new Map<string, IUser>();
    for (const guest of [...props.options(), ...known()]) {
      byId.set(guest.id, guestToUser(guest));
    }
    return [...byId.values()];
  });
  const excludedIds = createMemo(
    (): ReadonlySet<string> =>
      new Set((props.excluded ?? []).map((guest) => guest.id))
  );

  return (
    <PropertyEntitySelector
      config={{
        isMultiSelect: true,
        placeholder: 'Add guests...',
        specificEntityType: 'USER',
        users,
        excludedIds,
        allowCustomEmail: true,
      }}
      selectedOptions={() => new Set(props.selected.map((guest) => guest.id))}
      setSelectedOptions={(ids) => {
        props.onChange(
          [...ids].map((id) => guestFromId(id, props.options(), known()))
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
          <ul aria-label="New guests" class="flex flex-col">
            <For each={props.added}>
              {(guest) => (
                <li>
                  <EventGuestRow guest={guest}>
                    {props.addedControls?.(guest)}
                    <Button
                      label={`Remove ${guestDisplayName(guest)}`}
                      variant="ghost"
                      size="icon-sm"
                      class="shrink-0 text-ink-muted [&_svg]:size-3.5"
                      onClick={() =>
                        props.onAddedChange(
                          props.added.filter((added) => added.id !== guest.id)
                        )
                      }
                    >
                      <XIcon />
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
