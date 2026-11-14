import { usePending } from '@app/observability/flow';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CrmCompanyEntity,
  type CrmContactEntity,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import { Avatar } from '@ui';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { useInfiniteScrollSentinel } from '../../../lib/primitives/infinite-scroll-sentinel';
import {
  CrmListEmpty,
  CrmListError,
  CrmListRetry,
  CrmListSearchEmpty,
  CrmListSkeleton,
} from '../components/list-state';
import { ArchivedRecordBadge } from '../components/record-archived-status';
import { RecordSection } from '../components/record-section';
import { RecordVisibilityFilter } from '../components/record-visibility-filter';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact } from '../core/contact';
import { useCompanyContactsQuery, useIsTeamAdmin } from './use-crm';

function ContactRow(props: {
  contact: CrmContact;
  onOpen: (event: MouseEvent) => void;
  ownerId: string;
  archived: boolean;
}) {
  const email = props.contact.email;
  const photo = email ? useCrmContext().createContactPhoto?.(email) : undefined;
  const name = () => props.contact.name || props.contact.email || '';
  const entity = (): CrmContactEntity => ({
    ...props.contact,
    type: 'crm_contact',
    hidden: props.archived,
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
        <>
          <Show when={props.archived}>
            <ArchivedRecordBadge />
          </Show>
          <Show when={props.contact.name && props.contact.email}>
            <span class="min-w-0 truncate font-normal text-ink-extra-muted">
              {props.contact.email}
            </span>
          </Show>
        </>
      }
    />
  );
}

/** How long typing waits before the server is asked for the new search. */
const CONTACT_SEARCH_DEBOUNCE_MS = 250;

export function CompanyContactsSection(props: {
  company?: CrmCompanyEntity;
  onOpenContact?: (contact: CrmContact) => void;
}) {
  const context = useCrmContext();
  const { openWithSplit } = context.createNavigation();
  const isAdmin = useIsTeamAdmin();
  const [archivedCompany, setArchivedCompany] = createSignal<string>();
  const archived = () =>
    isAdmin() && !!props.company && archivedCompany() === props.company?.id;
  createRenderEffect(
    on(
      [
        context.userId,
        isAdmin,
        () => props.company?.teamId,
        () => props.company?.id,
      ],
      () => setArchivedCompany(undefined),
      { defer: true }
    )
  );
  const [search, setSearch] = createSignal('');
  const serverSearch = debouncedDependent(
    () => search().trim(),
    CONTACT_SEARCH_DEBOUNCE_MS
  );
  const source = useCompanyContactsQuery(() =>
    props.company
      ? {
          companyId: props.company.id,
          archived: archived(),
          search: serverSearch(),
        }
      : undefined
  );
  usePending('crm.company.contacts', () => !props.company || source.isPending);
  const [listRef, setListRef] = createSignal<HTMLElement>();
  const [sentinelRef, setSentinelRef] = createSignal<HTMLDivElement>();
  useInfiniteScrollSentinel({
    sentinel: sentinelRef,
    hasNextPage: () => source.hasNextPage && !source.isFetchNextPageError,
    isFetchingNextPage: () => source.isFetchingNextPage,
    fetchNextPage: () => fireAndForget(source.fetchNextPage(), 'crm'),
  });
  // The server answers the search and folds its case; its rows are shown as
  // they came. Rows that answer an earlier search (a placeholder until this
  // one's first page arrives) are narrowed here meanwhile. The archive state
  // is checked on every row, so an archive change moves a row at once.
  const filtered = createMemo(() => {
    const typed = search().trim();
    const query = source.loadedSearch === typed ? '' : typed.toLowerCase();
    return source.contacts.filter(
      (contact) =>
        (contact.hidden || !!props.company?.hidden) === archived() &&
        (!query ||
          contact.name?.toLowerCase().includes(query) ||
          contact.email?.toLowerCase().includes(query))
    );
  });
  const createContact = () => {
    if (props.company && !props.company.hidden)
      context.openCreateContact({ companyId: props.company.id });
  };

  return (
    <RecordSection
      title="Team"
      actions={
        <RecordVisibilityFilter
          archived={archived()}
          onChange={(value) =>
            setArchivedCompany(value ? props.company?.id : undefined)
          }
          disabled={!isAdmin()}
        />
      }
      search={search()}
      onSearchChange={setSearch}
      searchPlaceholder="Search contacts…"
      onSearchEscape={() => setSearch('')}
      createAction={{
        label: 'Add contact',
        onClick: createContact,
        disabled: !props.company || props.company.hidden,
      }}
      toolbarCreate
    >
      <Switch>
        <Match when={!props.company || source.isPending}>
          <CrmListSkeleton label="Loading contacts" />
        </Match>
        <Match when={source.isError}>
          <CrmListError
            title="Couldn't load contacts."
            onRetry={() => source.refetch()}
          />
        </Match>
        <Match when={!filtered().length && source.isSearching}>
          <CrmListSkeleton label="Searching contacts" />
        </Match>
        <Match when={!filtered().length && !source.hasNextPage}>
          <Show
            when={search().trim()}
            fallback={
              <CrmListEmpty
                title={archived() ? 'No archived people' : 'No contacts yet'}
                description={
                  archived() || props.company?.hidden
                    ? undefined
                    : 'Add a contact to this company to see them here.'
                }
                action={
                  props.company && !props.company.hidden && !archived()
                    ? { label: 'Add contact', onClick: createContact }
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
        </Match>
        <Match when={true}>
          <ListEntityMetadataQueryProvider>
            <ListLayoutProvider ref={listRef}>
              <div ref={setListRef} class="flex flex-col">
                <For each={filtered()}>
                  {(contact) => (
                    <ContactRow
                      contact={contact}
                      archived={archived()}
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
          <Show
            when={!source.isFetchNextPageError}
            fallback={
              <CrmListRetry
                message="Couldn't load more contacts."
                onRetry={() => source.fetchNextPage()}
              />
            }
          >
            <Show when={source.hasNextPage}>
              <div ref={setSentinelRef} class="h-px" />
            </Show>
            <Show when={source.isFetchingNextPage}>
              <CrmListSkeleton label="Loading more contacts" count={2} />
            </Show>
          </Show>
        </Match>
      </Switch>
    </RecordSection>
  );
}
