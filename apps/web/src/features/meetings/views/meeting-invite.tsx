import { UserIcon } from '@core/component/UserIcon';
import { Popover } from '@kobalte/core/popover';
import UserPlus from '@phosphor/user-plus.svg';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { AvatarGroup, Button, Layer, Tooltip } from '@ui';
import { type Accessor, createSignal, For, Show, Suspense } from 'solid-js';
import type { MeetingTeammatesSource } from '../context/meeting-invite';

export function MeetingInvite(props: {
  source: MeetingTeammatesSource;
  selected: Accessor<Set<string>>;
  setSelected: (selected: Set<string>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const selectedPeople = () =>
    props.source.people().filter((person) => props.selected().has(person.id));
  const selectedNames = () =>
    selectedPeople()
      .map((person) => person.name || person.email)
      .join(', ');

  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-start">
      <Tooltip
        label={selectedNames()}
        disabled={selectedPeople().length === 0 || open()}
        class="w-full"
      >
        <Popover.Trigger
          as={Button}
          type="button"
          variant="ghost"
          size="lg"
          disabled={props.disabled}
          aria-label={
            selectedPeople().length
              ? `Invite Teammates, ${selectedPeople().length} selected: ${selectedNames()}`
              : 'Invite Teammates'
          }
          class="w-full bg-hover text-ink [--avatar-group-separator:var(--color-hover)] not-touch:not-disabled:hover:bg-active not-touch:not-disabled:hover:[--avatar-group-separator:var(--color-active)] focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Show
            when={selectedPeople().length > 0}
            fallback={
              <>
                <UserPlus class="size-5" />
                Invite Teammates
              </>
            }
          >
            <AvatarGroup size="md" aria-hidden="true">
              <For each={selectedPeople().slice(0, 3)}>
                {(person) => (
                  <UserIcon
                    id={person.id}
                    size="md"
                    suppressClick
                    showTooltip={false}
                  />
                )}
              </For>
            </AvatarGroup>
            <span>
              {selectedPeople().length}{' '}
              {selectedPeople().length === 1 ? 'teammate' : 'teammates'}
            </span>
          </Show>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content class="z-action-menu w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-edge bg-menu-glass text-ink shadow-lg glass menu-open-animation">
            <Popover.Title class="sr-only">Invite teammates</Popover.Title>
            <Show when={open()}>
              <Suspense
                fallback={
                  <p class="px-3 py-4 text-sm text-ink-muted">
                    Loading teammates…
                  </p>
                }
              >
                <Show
                  when={!props.source.loading()}
                  fallback={
                    <p role="status" class="px-3 py-4 text-sm text-ink-muted">
                      Loading teammates…
                    </p>
                  }
                >
                  <Show
                    when={!props.source.error()}
                    fallback={
                      <div
                        class="flex items-center justify-between gap-2 px-3 py-3 text-xs text-ink-muted"
                        role="status"
                      >
                        <span>{props.source.error()}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={props.source.refresh}
                        >
                          Retry
                        </Button>
                      </div>
                    }
                  >
                    <PropertyEntitySelector
                      config={{
                        isMultiSelect: true,
                        specificEntityType: 'USER',
                        placeholder: 'Search teammates…',
                        users: props.source.people,
                        allowCustomEmail: false,
                      }}
                      selectedOptions={props.selected}
                      setSelectedOptions={(selected) => {
                        if (!props.disabled) props.setSelected(selected);
                      }}
                      onClose={() => setOpen(false)}
                    />
                  </Show>
                </Show>
              </Suspense>
            </Show>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
