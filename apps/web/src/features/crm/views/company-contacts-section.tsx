import {
  type CrmCompanyEntity,
  type CrmContactEntity,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import { Avatar } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import {
  CrmListEmpty,
  CrmListSearchEmpty,
  CrmListSkeleton,
} from '../components/list-state';
import { RecordSection } from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact } from '../core/contact';

function ContactRow(props: {
  contact: CrmContact;
  onOpen: (event: MouseEvent) => void;
  ownerId: string;
}) {
  const photo = useCrmContext().createContactPhoto?.(props.contact.email);
  const name = () => props.contact.name || props.contact.email;
  const entity = (): CrmContactEntity => ({
    ...props.contact,
    type: 'crm_contact',
    name: name(),
    ownerId: props.ownerId,
    sortTs: props.contact.lastInteraction,
  });
  return (
    <ListEntity
      entity={entity()}
      timestamp={props.contact.lastInteraction}
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.currentTarget.click();
      }}
      icon={
        <Avatar size="sm" aria-hidden="true">
          <Show when={photo?.()}>
            {(url) => <Avatar.Image src={url()} alt="" />}
          </Show>
          <Avatar.Fallback>{name().slice(0, 1).toUpperCase()}</Avatar.Fallback>
        </Avatar>
      }
      titleTrailing={
        <Show when={props.contact.name}>
          <span class="min-w-0 truncate font-normal text-ink-extra-muted">
            {props.contact.email}
          </span>
        </Show>
      }
    />
  );
}

export function CompanyContactsSection(props: {
  company?: CrmCompanyEntity;
  contacts?: CrmContact[];
  onOpenContact?: (contact: CrmContact) => void;
  actions?: JSX.Element;
}) {
  const context = useCrmContext();
  const { openWithSplit } = context.createNavigation();
  const [search, setSearch] = createSignal('');
  const [listRef, setListRef] = createSignal<HTMLElement>();
  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase();
    return (props.contacts ?? []).filter(
      (contact) =>
        !query ||
        contact.name?.toLowerCase().includes(query) ||
        contact.email.toLowerCase().includes(query)
    );
  });

  return (
    <RecordSection
      title="Team"
      search={search()}
      onSearchChange={setSearch}
      searchPlaceholder="Search contacts…"
      onSearchEscape={() => setSearch('')}
      actions={props.actions}
    >
      <Show
        when={props.company}
        fallback={<CrmListSkeleton label="Loading contacts" />}
      >
        <Show
          when={filtered().length}
          fallback={
            <Show
              when={search().trim()}
              fallback={
                <CrmListEmpty
                  title="No contacts yet"
                  description="Add a contact to this company to see them here."
                  action={
                    props.company?.domains?.[0]
                      ? {
                          label: 'Add contact',
                          onClick: () => {
                            const domain = props.company?.domains?.[0]?.domain;
                            if (domain && props.company)
                              context.openCreateContact({
                                companyId: props.company.id,
                                domain,
                              });
                          },
                        }
                      : undefined
                  }
                />
              }
            >
              <CrmListSearchEmpty
                title="No matching contacts."
                onClearSearch={() => setSearch('')}
              />
            </Show>
          }
        >
          <ListEntityMetadataQueryProvider>
            <ListLayoutProvider ref={listRef}>
              <div ref={setListRef} class="flex flex-col">
                <For each={filtered()}>
                  {(contact) => (
                    <ContactRow
                      contact={contact}
                      ownerId={props.company?.ownerId ?? ''}
                      onOpen={(event) => {
                        if (props.onOpenContact && !event.shiftKey) {
                          props.onOpenContact(contact);
                          return;
                        }
                        openWithSplit(
                          { type: 'contact', id: contact.id },
                          { activate: true, preferNewSplit: event.shiftKey }
                        );
                      }}
                    />
                  )}
                </For>
              </div>
            </ListLayoutProvider>
          </ListEntityMetadataQueryProvider>
        </Show>
      </Show>
    </RecordSection>
  );
}
