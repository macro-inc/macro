import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import External from '@phosphor/arrow-square-out.svg';
import Clock from '@phosphor/clock.svg';
import Copy from '@phosphor/copy.svg';
import Dots from '@phosphor/dots-three.svg';
import Link from '@phosphor/link.svg';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { EventType, SchedulingScope } from '../core/types';
import { TextInput } from './fields';

export function EventTypesPanel(props: {
  events: EventType[];
  owner?: SchedulingScope;
  search?: string;
  canEdit: boolean;
  saving: boolean;
  onEdit: (event: EventType) => void;
  onToggle: (event: EventType, enabled: boolean) => void;
  onDuplicate: (event: EventType) => void;
  onDelete: (event: EventType) => void;
  onCopy: (event: EventType) => void;
  link: (event: EventType) => string;
}) {
  const [localSearch, setSearch] = createSignal('');
  const search = () => (props.search ?? localSearch()).trim();
  const [removing, setRemoving] = createSignal<string>();
  const filtered = () =>
    props.events.filter((e) =>
      `${e.title} ${e.slug} ${props.owner?.name ?? ''} ${props.owner?.teamId ? 'team' : 'personal'}`
        .toLowerCase()
        .includes(search().toLowerCase())
    );
  return (
    <div class="flex flex-col gap-5">
      <Show when={props.search === undefined}>
        <div class="max-w-sm">
          <TextInput
            type="search"
            aria-label="Search event types"
            placeholder="Search event types…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
      </Show>
      <div class="divide-y divide-edge-muted border-y border-edge-muted">
        <For
          each={filtered()}
          fallback={
            <div class="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <Link class="size-7 text-ink-muted" />
              <h2 class="font-semibold">
                {search()
                  ? 'No matching event types'
                  : 'Create your first booking link'}
              </h2>
              <p class="max-w-sm text-sm text-ink-muted">
                {search()
                  ? 'Try a different title or link.'
                  : 'Choose a duration and availability, then share your link.'}
              </p>
            </div>
          }
        >
          {(event) => (
            <article class="py-4">
              <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div class="min-w-44 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!props.canEdit}
                      onClick={() => props.onEdit(event)}
                      class="max-w-full text-left"
                    >
                      <h2 class="truncate text-sm font-medium">
                        {event.title}
                      </h2>
                    </button>
                  </div>
                  <p class="mt-1 truncate text-xs text-ink-muted">
                    /{event.slug}
                  </p>
                  <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                    <span class="inline-flex items-center gap-1">
                      <Clock class="size-3" />
                      {event.durationMinutes}m
                    </span>
                    <span>
                      {event.mode === 'roundRobin'
                        ? 'Round robin'
                        : event.mode === 'collective'
                          ? 'Collective'
                          : 'One-on-one'}
                    </span>
                    <Show when={!event.enabled}>
                      <span>Paused</span>
                    </Show>
                    <Show when={event.requiresConfirmation}>
                      <span>Requires confirmation</span>
                    </Show>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <ToggleSwitch
                    checked={event.enabled}
                    disabled={!props.canEdit || props.saving}
                    label={
                      <span class="sr-only">
                        Accept bookings for {event.title}
                      </span>
                    }
                    controlClass="data-checked:bg-ink"
                    onChange={(v) => props.onToggle(event, v)}
                  />
                  <a
                    aria-label={`Preview ${event.title}`}
                    class="rounded-md p-2 text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink"
                    href={props.link(event)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <External class="size-4" />
                  </a>
                  <Button
                    variant="ghost"
                    size="icon-md"
                    label={`Copy link for ${event.title}`}
                    onClick={() => props.onCopy(event)}
                    disabled={!event.enabled}
                  >
                    <Copy class="size-4" />
                  </Button>
                  <Show when={props.canEdit}>
                    <DropdownMenu>
                      <DropdownMenu.Trigger
                        as={Button}
                        variant="ghost"
                        size="icon-md"
                        label={`Options for ${event.title}`}
                      >
                        <Dots class="size-5" />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content class="menu-surface z-action-menu min-w-40 p-1 text-sm">
                          <DropdownMenu.Item
                            class="rounded px-3 py-2 outline-none data-highlighted:bg-hover"
                            onSelect={() => props.onEdit(event)}
                          >
                            Edit
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            class="rounded px-3 py-2 outline-none data-highlighted:bg-hover"
                            onSelect={() => props.onDuplicate(event)}
                          >
                            Duplicate
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            class="rounded px-3 py-2 text-failure outline-none data-highlighted:bg-hover"
                            onSelect={() => setRemoving(event.id)}
                          >
                            Delete
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu>
                  </Show>
                </div>
              </div>
              <Show when={props.canEdit && removing() === event.id}>
                <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-edge-muted pt-4">
                  <p class="flex-1 text-sm">
                    Delete this event type? Existing bookings are kept.
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => setRemoving(undefined)}
                  >
                    Keep
                  </Button>
                  <Button
                    variant="outline"
                    disabled={props.saving}
                    onClick={() => props.onDelete(event)}
                  >
                    Delete event type
                  </Button>
                </div>
              </Show>
            </article>
          )}
        </For>
      </div>
    </div>
  );
}
