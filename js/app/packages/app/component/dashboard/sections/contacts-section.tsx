import { useSplitLayout } from '@app/component/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import AddressBookIcon from '@phosphor/address-book.svg';
import ChatIcon from '@phosphor/chat-circle.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { useContacts } from '@queries/contacts/contacts';
import { createMemo, createSignal, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const CONTACTS_INITIAL = 6;
const CONTACTS_INCREMENT = 10;

interface ContactsSectionProps {
  class?: string;
}

export function ContactsSection(props: ContactsSectionProps) {
  return (
    <DashboardSection
      title="Contacts"
      icon={<AddressBookIcon />}
      class={props.class}
      fallback={<DashboardSectionLoading rows={3} />}
    >
      <ContactsContent />
    </DashboardSection>
  );
}

function ContactRow(props: { userId: string }) {
  const { openWithSplit } = useSplitLayout();
  const [displayName] = useDisplayName(tryMacroId(props.userId));

  const handleClick = () => {
    openWithSplit({
      type: 'chat',
      id: 'new',
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      class="flex items-center gap-3 py-2.5 px-3 w-full text-left hover:bg-ink/5 rounded-lg transition-colors group"
    >
      <UserIcon id={props.userId} size="sm" suppressClick />
      <span class="flex-1 text-sm text-ink truncate">{displayName()}</span>
      <div class="size-6 rounded flex items-center justify-center text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity">
        <ChatIcon class="size-4" />
      </div>
    </button>
  );
}

function ContactsContent() {
  const contacts = useContacts();
  const [search, setSearch] = createSignal('');
  const [limit, setLimit] = createSignal(CONTACTS_INITIAL);

  const filteredContacts = createMemo(() => {
    const query = search().toLowerCase().trim();
    const all = contacts();
    if (!query) return all;
    return all.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query)
    );
  });

  const displayedContacts = createMemo(() =>
    filteredContacts().slice(0, limit())
  );

  const hasMore = createMemo(() => filteredContacts().length > limit());

  const loadMore = () => {
    setLimit((l) => l + CONTACTS_INCREMENT);
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="relative">
        <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-ink-muted" />
        <input
          type="text"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          placeholder="Search contacts..."
          class="w-full pl-8 pr-3 py-1.5 text-sm bg-ink/5 rounded-lg border border-transparent focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none placeholder:text-ink-muted"
        />
      </div>
      <Show
        when={displayedContacts().length > 0}
        fallback={
          <DashboardEmptyState
            icon={<AddressBookIcon />}
            title={search() ? 'No matches' : 'No contacts'}
            description={search() ? undefined : 'Add contacts to message them'}
            compact
          />
        }
      >
        <div class="flex flex-col max-h-56 overflow-y-auto -m-3">
          <For each={displayedContacts()}>
            {(contact) => <ContactRow userId={contact.id} />}
          </For>
          <Show when={hasMore()}>
            <button
              type="button"
              onClick={loadMore}
              class="mt-1 mb-3 mx-3 py-2 text-xs text-ink-muted bg-ink/5 hover:bg-ink/10 rounded-lg transition-colors"
            >
              Load more ({filteredContacts().length - limit()} remaining)
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
