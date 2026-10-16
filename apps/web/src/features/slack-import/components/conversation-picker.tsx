import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { InputGroup } from '@ui';
import { createUniqueId, For, type JSX, onMount, Show } from 'solid-js';
import type {
  ArchiveDiscovery,
  ConversationKind,
  ConversationMetadata,
  ExportUser,
} from '../core/export';
import {
  ConversationKindIcon,
  DialogSectionTitle,
  NativeCheckbox,
} from './import-ui';

type Props = {
  discovery: ArchiveDiscovery;
  selected: ReadonlySet<string>;
  unsupported: ReadonlySet<string>;
  filter: string;
  showArchived: boolean;
  onFilter(value: string): void;
  onShowArchived(value: boolean): void;
  onSelect(ids: string[], selected: boolean): void;
};

const GROUPS: { kind: ConversationKind; label: string; target: string }[] = [
  { kind: 'public_channel', label: 'Public channels', target: 'Team channels' },
  {
    kind: 'private_channel',
    label: 'Private channels',
    target: 'Private channels',
  },
  {
    kind: 'direct_message',
    label: 'Direct messages',
    target: 'Direct messages',
  },
  {
    kind: 'group_direct_message',
    label: 'Group DMs',
    target: 'Private channels',
  },
];

/** Slack exports name DMs by id and group DMs `mpdm-a--b-1`; members read better. */
function displayName(
  conversation: ConversationMetadata,
  users: ReadonlyMap<string, ExportUser>
): string {
  const isDm =
    conversation.kind === 'direct_message' ||
    conversation.kind === 'group_direct_message';
  const generated =
    conversation.name === conversation.slackChannelId ||
    (isDm && conversation.name.startsWith('mpdm-'));
  if (conversation.name && !generated) return conversation.name;
  const members = conversation.memberIds
    .map((id) => {
      const user = users.get(id);
      return user?.real_name || user?.profile?.display_name || user?.name || id;
    })
    .join(', ');
  return members || conversation.slackChannelId;
}

export function ConversationPicker(props: Props): JSX.Element {
  let search: HTMLInputElement | undefined;
  // Discovery replaces the disabled file input inside an already-open dialog.
  onMount(() => search?.focus());
  const users = () =>
    new Map(props.discovery.users.map((user) => [user.id, user]));
  const named = () =>
    props.discovery.conversations.map((conversation) => ({
      ...conversation,
      name: displayName(conversation, users()),
    }));
  const visible = () =>
    named().filter(
      (conversation) =>
        (props.showArchived || !conversation.archived) &&
        `${conversation.name} ${conversation.slackChannelId}`
          .toLowerCase()
          .includes(props.filter.toLowerCase())
    );
  const selectable = () =>
    visible().filter(
      (conversation) => !props.unsupported.has(conversation.slackChannelId)
    );
  const allSelected = () =>
    selectable().length > 0 &&
    selectable().every((conversation) =>
      props.selected.has(conversation.slackChannelId)
    );
  const anyVisibleSelected = () =>
    selectable().some((conversation) =>
      props.selected.has(conversation.slackChannelId)
    );
  const selectableIds = () =>
    selectable().map((conversation) => conversation.slackChannelId);

  return (
    <section class="flex flex-col gap-3" aria-label="Conversations">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <DialogSectionTitle>Conversations</DialogSectionTitle>
        <label class="flex items-center gap-2 text-xs text-ink-muted">
          <NativeCheckbox
            checked={props.showArchived}
            onChange={(event) =>
              props.onShowArchived(event.currentTarget.checked)
            }
          />
          Show archived conversations
        </label>
      </div>

      <InputGroup size="lg">
        <InputGroup.Addon>
          <MagnifyingGlassIcon class="size-4" />
        </InputGroup.Addon>
        <InputGroup.Input
          ref={search}
          type="search"
          aria-label="Filter conversations"
          placeholder="Filter conversations"
          class="text-sm"
          value={props.filter}
          onInput={(event) => props.onFilter(event.currentTarget.value)}
        />
        <InputGroup.Addon align="inline-end">
          <InputGroup.ClearButton />
        </InputGroup.Addon>
      </InputGroup>

      <div class="overflow-hidden rounded-lg border border-edge-muted">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-edge-divider bg-ink/3 px-4 py-2 text-sm">
          <label class="flex items-center gap-3 text-ink">
            <NativeCheckbox
              checked={allSelected()}
              disabled={!selectable().length}
              onChange={(event) =>
                props.onSelect(selectableIds(), event.currentTarget.checked)
              }
            />
            Select all visible conversations
          </label>
          <div class="flex items-center gap-3 text-xs">
            <span class="text-ink-muted">{props.selected.size} selected</span>
            <button
              type="button"
              class="font-medium text-link outline-none hover:text-link-hover hover:underline focus-visible:underline disabled:pointer-events-none disabled:opacity-50"
              disabled={!anyVisibleSelected()}
              onClick={() => props.onSelect(selectableIds(), false)}
            >
              Clear visible selection
            </button>
          </div>
        </div>
        <div class="max-h-64 overflow-y-auto">
          <Show
            when={visible().length}
            fallback={
              <p class="px-4 py-6 text-center text-sm text-ink-muted">
                No matching conversations.
              </p>
            }
          >
            <For each={GROUPS}>
              {(group) => (
                <ConversationGroup
                  {...group}
                  conversations={visible().filter(
                    (conversation) => conversation.kind === group.kind
                  )}
                  selected={props.selected}
                  unsupported={props.unsupported}
                  onSelect={props.onSelect}
                />
              )}
            </For>
          </Show>
        </div>
      </div>
      <p class="text-xs text-ink-extra-muted">
        Filtering never clears your selection. Message counts are available
        after import.
      </p>
    </section>
  );
}

function ConversationGroup(
  props: (typeof GROUPS)[number] &
    Pick<Props, 'selected' | 'unsupported' | 'onSelect'> & {
      conversations: ArchiveDiscovery['conversations'];
    }
): JSX.Element {
  const headingId = createUniqueId();
  return (
    <Show when={props.conversations.length}>
      <div role="group" aria-labelledby={headingId} class="min-w-0">
        <div
          id={headingId}
          class="sticky top-0 z-10 flex items-center gap-1.5 bg-surface px-4 pt-3 pb-1 text-xs font-medium text-ink-muted"
        >
          {props.label}
          <Show when={props.target !== props.label}>
            <span class="font-normal text-ink-extra-muted">
              → {props.target}
            </span>
          </Show>
        </div>
        <For each={props.conversations}>
          {(conversation) => {
            const unsupported = () =>
              props.unsupported.has(conversation.slackChannelId);
            return (
              <label class="flex items-center gap-3 px-4 py-2 text-sm hover:bg-ink/4 has-disabled:opacity-60 has-disabled:hover:bg-transparent">
                <NativeCheckbox
                  checked={props.selected.has(conversation.slackChannelId)}
                  disabled={unsupported()}
                  onChange={(event) =>
                    props.onSelect(
                      [conversation.slackChannelId],
                      event.currentTarget.checked
                    )
                  }
                />
                <ConversationKindIcon kind={conversation.kind} />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-ink">
                    {conversation.name || conversation.slackChannelId}
                  </span>
                  <span class="block truncate text-xs text-ink-muted">
                    {conversation.slackChannelId} ·{' '}
                    {conversation.memberIds.length} source members
                    {conversation.archived ? ' · Archived' : ''}
                  </span>
                  <Show when={unsupported()}>
                    <span class="block text-xs text-warning-ink">
                      Unavailable: a DM needs exactly two distinct members with
                      email addresses.
                    </span>
                  </Show>
                </span>
              </label>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
