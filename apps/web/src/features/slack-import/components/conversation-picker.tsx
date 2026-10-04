import { For, type JSX, onMount, Show } from 'solid-js';
import type { ArchiveDiscovery, ConversationKind } from '../core/export';

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

const groups: { kind: ConversationKind; label: string }[] = [
  { kind: 'public_channel', label: 'Public Slack channels → Team channels' },
  { kind: 'private_channel', label: 'Private channels' },
  { kind: 'direct_message', label: 'Direct messages' },
  { kind: 'group_direct_message', label: 'Group DMs → Private channels' },
];

export function ConversationPicker(props: Props): JSX.Element {
  let search: HTMLInputElement | undefined;
  // Discovery replaces the disabled file input inside an already-open dialog.
  onMount(() => search?.focus());
  const visible = () =>
    props.discovery.conversations.filter(
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

  return (
    <section class="flex flex-col gap-3" aria-label="Conversations">
      <label class="flex flex-col gap-1 text-sm">
        Filter conversations
        <input
          ref={search}
          type="search"
          class="rounded border border-edge-muted bg-input p-2 text-ink"
          value={props.filter}
          onInput={(event) => props.onFilter(event.currentTarget.value)}
        />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.showArchived}
          onChange={(event) =>
            props.onShowArchived(event.currentTarget.checked)
          }
        />
        Show archived conversations
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allSelected()}
          disabled={!selectable().length}
          onChange={(event) =>
            props.onSelect(
              selectable().map((conversation) => conversation.slackChannelId),
              event.currentTarget.checked
            )
          }
        />
        Select all visible conversations
      </label>
      <button
        type="button"
        class="self-start text-sm underline disabled:opacity-50"
        disabled={
          !selectable().some((conversation) =>
            props.selected.has(conversation.slackChannelId)
          )
        }
        onClick={() =>
          props.onSelect(
            selectable().map((conversation) => conversation.slackChannelId),
            false
          )
        }
      >
        Clear visible selection
      </button>
      <p class="text-sm text-ink-muted">
        {props.selected.size} selected. Filtering does not clear selections.
        Message counts are not yet counted.
      </p>
      <div class="max-h-72 overflow-y-auto rounded border border-edge-muted p-3">
        <Show
          when={visible().length}
          fallback={
            <p class="text-sm text-ink-muted">No matching conversations.</p>
          }
        >
          <For each={groups}>
            {(group) => (
              <Show
                when={visible().some(
                  (conversation) => conversation.kind === group.kind
                )}
              >
                <fieldset class="mb-3 min-w-0">
                  <legend class="text-sm font-medium">{group.label}</legend>
                  <For
                    each={visible().filter(
                      (conversation) => conversation.kind === group.kind
                    )}
                  >
                    {(conversation) => (
                      <label class="flex items-start gap-2 py-2 text-sm">
                        <input
                          type="checkbox"
                          class="mt-1 shrink-0"
                          checked={props.selected.has(
                            conversation.slackChannelId
                          )}
                          disabled={props.unsupported.has(
                            conversation.slackChannelId
                          )}
                          onChange={(event) =>
                            props.onSelect(
                              [conversation.slackChannelId],
                              event.currentTarget.checked
                            )
                          }
                        />
                        <span class="min-w-0 break-words">
                          {conversation.name || conversation.slackChannelId}
                          <span class="block text-xs text-ink-muted">
                            {conversation.slackChannelId} ·{' '}
                            {conversation.memberIds.length} source members ·{' '}
                            {conversation.messageCount == null
                              ? 'Messages not yet counted'
                              : `${conversation.messageCount} messages`}
                            {conversation.archived ? ' · Archived' : ''}
                          </span>
                          <Show
                            when={props.unsupported.has(
                              conversation.slackChannelId
                            )}
                          >
                            <span class="block text-xs text-ink-muted">
                              Unavailable: a DM requires exactly two distinct
                              members with email addresses.
                            </span>
                          </Show>
                        </span>
                      </label>
                    )}
                  </For>
                </fieldset>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
