import { useSplitLayout } from '@app/component/split-layout/layout';
import type { CrmCompanyEntity } from '@entity';
import type { CompanyContact } from '@queries/crm/companies';
import { createMemo, createSignal, For, Show } from 'solid-js';

export function CompanyContactsSection(props: {
  company?: CrmCompanyEntity;
  contacts?: CompanyContact[];
}) {
  const contacts = () => props.contacts ?? [];
  const { replaceOrInsertSplit } = useSplitLayout();

  const [search, setSearch] = createSignal('');
  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase();
    if (!query) return contacts();
    return contacts().filter(
      (contact) =>
        contact.name?.toLowerCase().includes(query) ||
        contact.email.toLowerCase().includes(query)
    );
  });

  return (
    <Show
      when={props.company}
      fallback={<div class="text-sm text-ink-muted">Loading…</div>}
    >
      <Show
        when={contacts().length > 0}
        fallback={<div class="text-sm text-ink-muted">No contacts yet.</div>}
      >
        <div class="flex flex-col gap-2">
          <input
            type="text"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search contacts…"
            class="w-full rounded-md border border-edge bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-placeholder focus:outline-none"
          />
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="text-sm text-ink-muted">No matching contacts.</div>
            }
          >
            <div
              class="flex flex-col gap-2"
              classList={{
                // ~5 two-line rows tall; scroll for the rest.
                'max-h-[13.5rem] overflow-y-auto scrollbar-hidden':
                  filtered().length > 5,
              }}
            >
              <For each={filtered()}>
                {(contact) => (
                  <button
                    type="button"
                    onClick={() =>
                      replaceOrInsertSplit({
                        type: 'contact',
                        id: contact.id,
                      })
                    }
                    class="flex min-w-0 flex-col gap-0.5 rounded-md px-1 py-0.5 text-left hover:bg-ink-muted/[0.06]"
                  >
                    <span class="truncate text-sm">
                      {contact.name ?? contact.email}
                    </span>
                    <Show when={contact.name}>
                      <span class="truncate text-xs text-ink-muted">
                        {contact.email}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  );
}
