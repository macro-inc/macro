import { UserIcon } from '@core/component/UserIcon';
import type { IUser } from '@core/user/types';
import { Popover } from '@kobalte/core/popover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';

/** Single-assignee property picker; only its open window and current choice live here. */
export function ImportAssigneePicker(props: {
  label: string;
  person: IUser | null;
  disabled: boolean;
  onChange: (person: IUser | null) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let picked: IUser | undefined;
  const label = () => {
    const person = props.person;
    if (!person) return 'Unassigned';
    return person.name && person.name !== person.email
      ? `${person.name} (${person.email})`
      : person.email;
  };
  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={setOpen}
      placement="bottom-end"
    >
      <Popover.Trigger
        as={Button}
        variant="secondary"
        size="sm"
        disabled={props.disabled}
        aria-label={`Map ${props.label}`}
        class="max-w-full min-w-40 justify-start sm:max-w-80"
      >
        <Show when={props.person}>
          {(person) => (
            <UserIcon
              id={person().id}
              name={person().name || person().email}
              size="sm"
              showTooltip={false}
              suppressClick
            />
          )}
        </Show>
        <span class="truncate" title={label()}>
          {label()}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="menu-surface z-action-menu w-80 max-w-[calc(100vw-1rem)] menu-open-animation">
          <Popover.Title class="sr-only">Map assignee</Popover.Title>
          <PropertyEntitySelector
            config={{
              specificEntityType: 'USER',
              isMultiSelect: false,
              placeholder: 'Search assignees...',
              additionalUsers: () => (props.person ? [props.person] : []),
            }}
            selectedOptions={() =>
              new Set(props.person ? [props.person.id] : [''])
            }
            pinnedOptions={[{ id: '', label: 'Unassigned' }]}
            onUserSelected={(user) => {
              picked = { id: user.id, email: user.email, name: user.name };
            }}
            setSelectedOptions={(ids) => {
              const id = [...ids][0];
              const current = picked;
              picked = undefined;
              if (!id) props.onChange(null);
              else if (current?.id === id) props.onChange(current);
              else if (props.person?.id === id) props.onChange(props.person);
            }}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
