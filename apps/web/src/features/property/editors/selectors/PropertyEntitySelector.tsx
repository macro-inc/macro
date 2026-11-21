import { useCrmCompanySearchSource } from '@app/features/crm/crm-search';
import { useCrmContactMentionSource } from '@app/features/crm/record-adapter';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useInfiniteScrollSentinel } from '@app/lib/primitives/infinite-scroll-sentinel';
import { UserIcon } from '@core/component/UserIcon';
import { disableCrmContactSearch } from '@core/constant/featureFlags';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { QuickAccessItem } from '@core/context/quickAccess';
import { deduplicateContactItems } from '@core/context/quickAccess/crm-contacts';
import { keepUnchangedRows } from '@core/context/quickAccess/unchanged-rows';
import { useEmail, useUserId } from '@core/context/user';
import { emailToId, useAugmentUserWithDmActivity } from '@core/user';
import {
  capPeople,
  rankAgentsAfterPeople,
} from '@core/user/people-before-agents';
import type { IUser } from '@core/user/types';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { createFreshSearch } from '@core/util/freshSort';
import { preserveOrderedWindow } from '@core/util/ordered-window';
import { createSelectionAnchor } from '@core/util/selection-anchor';
import { matchesTokenSubsequences } from '@core/util/string';
import { useKeyPressed } from '@core/util/useKeyPressed';
import { useSelectedFirst } from '@core/util/useSelectedFirst';
import {
  createEmailsInfiniteQuery,
  type EmailEntity,
  Entity,
  type EntityData,
} from '@entity';
import CheckIcon from '@icon/system/regular/check.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { useSearchInputFocus } from '@property/utils';
import { usePinnedContactUsers } from '@queries/contacts/use-directory';
import {
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { debounce } from '@solid-primitives/scheduled';
import { Button, cn, InlineCheckbox, inputClasses } from '@ui';
import * as EmailValidator from 'email-validator';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  Show,
} from 'solid-js';
import {
  allowsEntityType,
  type CombinedEntity,
  createEntitySearchConfig,
  createRosterSearch,
  getEntitySearchText,
  getEntityTimestampedItem,
  getEntityType,
  isChannelEntity,
  quickAccessItemToEntity,
  sortEntitiesWithSelfFirst,
  threadMapper,
  useQuickAccessEntities,
  userToEntity,
} from './entityUtils';
import { OptionCheckBox } from './OptionCheckBox';
import type { EntitySelectorConfig } from './types';

type EntityInputProps = {
  config: EntitySelectorConfig;
  selectedOptions: () => Set<string>;
  setSelectedOptions: (
    options: Set<string>,
    entityInfo?: { id: string; entity_type: EntityType; name: string }[]
  ) => void;
  /** UI-only selection metadata; never added to persisted entity references. */
  onUserSelected?: (user: IUser, custom: boolean) => void;
  onClose?: () => void;
  /** Escape in the search; `onClose` when absent, as a popover saves on close. */
  onCancel?: () => void;
  /** Standalone sheet spacing; leaves the popover presentation unchanged. */
  presentation?: 'sheet';
  /** Override empty-result content; null hides the default message. */
  emptyState?: JSX.Element;
};

function getEntityTypePluralLabel(
  entityType: EntityType | EntityType[] | null | undefined
): string {
  if (!entityType || Array.isArray(entityType)) return 'entities';
  switch (entityType) {
    case 'USER':
      return 'users';
    case 'DOCUMENT':
      return 'documents';
    case 'CHANNEL':
      return 'channels';
    case 'PROJECT':
      return 'projects';
    case 'CHAT':
      return 'chats';
    case 'COMPANY':
      return 'companies';
    case 'CONTACT':
      return 'contacts';
    case 'THREAD':
      return 'emails';
    case 'TASK':
      return 'tasks';
    default:
      return 'entities';
  }
}

type UserEntityParts = {
  name: string;
  email?: string;
};

function getUserEntityParts(entity: CombinedEntity): UserEntityParts | null {
  if (entity.kind !== 'user') return null;

  const { name, email } = entity.data;
  if (!name || name === email) return { name: email };
  return { name, email };
}

/** Gets display name for a CombinedEntity */
function getEntityName(entity: CombinedEntity): string {
  if (entity.kind === 'user') {
    return entity.data.name || entity.data.email;
  }

  const data = entity.data;
  if (data.type === 'email') {
    return data.name ?? 'No Subject';
  }
  return data.name ?? '';
}

const MAX_LIST_HEIGHT = 192;
const MAX_VISIBLE_ENTITIES_NO_SEARCH = 50;
const MAX_SEARCH_RESULTS = 20;
const SERVER_SEARCH_DEBOUNCE_MS = 250;

/** Server contact matches join the Quick Access rows, one row per email.
 * Rows the picker excludes leave first, so they never displace an eligible
 * record of the same email. */
function withServerContacts(
  items: readonly QuickAccessItem[],
  server: readonly QuickAccessItem[],
  excluded: (id: string) => boolean
): readonly QuickAccessItem[] {
  if (server.length === 0) return items;
  const listed = new Set(items.map((item) => item.id));
  return deduplicateContactItems(
    [...items, ...server.filter((item) => !listed.has(item.id))].filter(
      (item) => !excluded(item.id)
    )
  );
}

function getMaxLocalResults(
  hasExplicitUserPool: boolean,
  hasSearchTerm: boolean,
  availableResultCount: number
): number {
  // Query-backed lists already bound each loaded page. Only explicit user
  // rosters, which have no pagination, retain the local display caps.
  if (!hasExplicitUserPool) return availableResultCount;
  return hasSearchTerm ? MAX_SEARCH_RESULTS : MAX_VISIBLE_ENTITIES_NO_SEARCH;
}

export function PropertyEntitySelector(props: EntityInputProps) {
  const [inputValue, setRawInputValue] = createSignal('');
  const [searchTerm, setSearchTerm] = createSignal('');
  // Personal reads debounce themselves. Their UI must stop offering the old
  // query immediately, particularly when Enter selects a custom address.
  const search = () =>
    props.config.specificEntityType === 'USER'
      ? inputValue().toLowerCase()
      : searchTerm();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const openedSelectedIds = [...props.selectedOptions()];
  const setInputValue = (value: string) => {
    setSelectedIndex(0);
    setRawInputValue(value);
  };
  const keyboardMode = useKeyPressed(100);

  let scrollContainerRef: HTMLDivElement | undefined;

  // Debounce search term updates (60ms like MentionsMenu)
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );
  createEffect(() => debouncedSetSearchTerm(inputValue()));

  let searchInputRef!: HTMLInputElement;

  // Get self-filter context from config
  const selfFilterEntityType = () => props.config.selfFilter?.entityType;
  const selfFilterBlockId = () => props.config.selfFilter?.blockId;

  const augmentUserWithDmActivity = useAugmentUserWithDmActivity();

  // Get current user info for same-domain boost and self-boost in search
  const currentUserEmail = useEmail();
  const currentUserId = useUserId();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  // Get items from quickAccess based on entity type
  const quickAccess = useQuickAccessEntities(
    () => props.config.specificEntityType,
    search,
    () =>
      props.config.specificEntityType !== 'THREAD' &&
      !(props.config.specificEntityType === 'USER' && props.config.users),
    () => props.config.excludedIds?.() ?? new Set<string>()
  );
  const isQuickAccessLoading = quickAccess.isLoading;

  // Quick Access holds recent and cached contacts only. A typed search also
  // reads the server's CRM contact search, as Cmd+K and @ mentions do, so any
  // contact Customers > People finds is found here too.
  const contactSearchDisabled = useFeatureFlag(disableCrmContactSearch);
  const typedContactSearch = () =>
    allowsEntityType(props.config.specificEntityType, 'CONTACT') &&
    !contactSearchDisabled().enabled
      ? search().trim()
      : '';
  const contactSearch = debouncedDependent(
    typedContactSearch,
    SERVER_SEARCH_DEBOUNCE_MS
  );
  const contactSearchEnabled = () =>
    typedContactSearch().length > 0 && contactSearch().length > 0;
  const serverContacts = useCrmContactMentionSource(
    contactSearch,
    contactSearchEnabled,
    () => false
  );
  const contactSearchPending = () =>
    typedContactSearch().length > 0 &&
    (typedContactSearch() !== contactSearch() || serverContacts.isLoading());
  const isExcludedContact = (id: string) =>
    !!props.config.excludedIds?.().has(id) ||
    (props.config.selfFilter?.entityType === 'CONTACT' &&
      props.config.selfFilter.blockId === id);
  const quickAccessItems = createMemo(() =>
    contactSearchEnabled()
      ? withServerContacts(
          quickAccess.items(),
          serverContacts.entities(),
          isExcludedContact
        )
      : quickAccess.items()
  );

  // Quick Access holds the 500 most recent companies. A typed search also
  // reads the search service's company name and domain match, where Cmd+K's
  // company results come from, so any company Customers lists is found here.
  const typedCompanySearch = () =>
    allowsEntityType(props.config.specificEntityType, 'COMPANY')
      ? search().trim()
      : '';
  const companySearch = debouncedDependent(
    typedCompanySearch,
    SERVER_SEARCH_DEBOUNCE_MS
  );
  const typedCompanySearchValid = () =>
    typedCompanySearch().length > 0 &&
    validateSearchServiceText(typedCompanySearch());
  const companySearchEnabled = () =>
    typedCompanySearchValid() && validateSearchServiceText(companySearch());
  const serverCompanies = useCrmCompanySearchSource(
    companySearch,
    companySearchEnabled
  );
  const companySearchPending = () =>
    typedCompanySearchValid() &&
    (typedCompanySearch() !== companySearch() || serverCompanies.isLoading());
  // Rows answering an earlier search stay only while they still match. A row
  // keeps its object while its company is unchanged, so a further page does
  // not remount the rows already listed.
  const serverCompanyEntities = createMemo((previous: CombinedEntity[]) => {
    if (!companySearchEnabled()) return [];
    const term = typedCompanySearch();
    const settled = companySearch() === term;
    const rows = serverCompanies
      .companies()
      .map(
        (company): CombinedEntity => ({
          kind: 'entity',
          id: company.id,
          data: company,
        })
      )
      .filter(
        (entity) =>
          settled || matchesTokenSubsequences(getEntitySearchText(entity), term)
      );
    return keepUnchangedRows(previous, rows);
  }, []);

  // Fetch emails for browsing whenever threads are allowed: THREAD alone,
  // among several kinds, or any kind.
  const needsEmailSearch = () =>
    allowsEntityType(props.config.specificEntityType, 'THREAD');

  const emailsQuery = createEmailsInfiniteQuery(() => ({ view: 'all' }), {
    disabled: () => !needsEmailSearch(),
  });
  const emails = () => emailsQuery.data ?? [];

  // Server-side email search (query internally disables on blank text)
  const emailSearchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: 20 },
      body: {
        query: search(),
        match_type: 'partial' as const,
        include: ['emails' as const],
        search_on: 'name' as const,
      },
    }),
    () => ({
      enabled: needsEmailSearch(),
    })
  );

  // Server search results mapped to our format
  const serverEmails = createMemo((): CombinedEntity[] => {
    if (emailSearchQuery.status !== 'success' || !emailSearchQuery.data) {
      return [];
    }
    return emailSearchQuery.data
      .filter((entity) => entity.type === 'email')
      .map((entity) => threadMapper(entity as EmailEntity));
  });

  const emailSearchEnabled = () =>
    needsEmailSearch() && validateSearchServiceText(search().trim());
  const hasMore = () =>
    quickAccess.hasMore() ||
    (contactSearchEnabled() && serverContacts.hasMore()) ||
    (companySearchEnabled() && serverCompanies.hasMore()) ||
    (needsEmailSearch() &&
      (emailsQuery.hasNextPage ||
        (emailSearchEnabled() && emailSearchQuery.hasNextPage)));
  const isLoadingMore = () =>
    quickAccess.isLoadingMore() ||
    (contactSearchEnabled() && serverContacts.isLoadingMore()) ||
    (companySearchEnabled() && serverCompanies.isLoadingMore()) ||
    (needsEmailSearch() &&
      (emailsQuery.isFetchingNextPage || emailSearchQuery.isFetchingNextPage));
  const paginationError = () => {
    const quickAccessError = quickAccess.error();
    if (quickAccessError) return quickAccessError;
    const contactError = contactSearchEnabled()
      ? serverContacts.error()
      : undefined;
    if (contactError) return contactError;
    const companyError = companySearchEnabled()
      ? serverCompanies.error()
      : undefined;
    if (companyError) return companyError;
    if (!needsEmailSearch()) return undefined;
    if (emailsQuery.error) return emailsQuery.error;
    return emailSearchEnabled() ? emailSearchQuery.error : undefined;
  };
  const loadNextPages = async () => {
    const requests: Promise<unknown>[] = [];
    if (quickAccess.hasMore() && !quickAccess.isLoadingMore()) {
      requests.push(quickAccess.loadMore());
    }
    if (
      contactSearchEnabled() &&
      serverContacts.hasMore() &&
      !serverContacts.isLoadingMore()
    ) {
      requests.push(serverContacts.loadMore());
    }
    if (
      companySearchEnabled() &&
      serverCompanies.hasMore() &&
      !serverCompanies.isLoadingMore()
    ) {
      requests.push(serverCompanies.loadMore());
    }
    if (needsEmailSearch()) {
      if (emailsQuery.hasNextPage && !emailsQuery.isFetchingNextPage) {
        requests.push(emailsQuery.fetchNextPage());
      }
      if (
        emailSearchEnabled() &&
        emailSearchQuery.hasNextPage &&
        !emailSearchQuery.isFetchingNextPage
      ) {
        requests.push(emailSearchQuery.fetchNextPage());
      }
    }
    await Promise.all(requests);
  };

  const isLoadingEntities = createMemo(() => {
    if (props.config.users) return false;
    if (needsEmailSearch()) {
      return (
        emailsQuery.isLoading ||
        emailsQuery.isPending ||
        emailSearchQuery.isFetching ||
        contactSearchPending() ||
        companySearchPending()
      );
    }
    return (
      isQuickAccessLoading() || contactSearchPending() || companySearchPending()
    );
  });

  // An explicit user pool replaces Quick Access options.
  const scopedUserEntities = createMemo(() => {
    if (props.config.specificEntityType !== 'USER' || !props.config.users) {
      return undefined;
    }
    return [
      ...props.config.users(),
      ...(props.config.additionalUsers?.() ?? []),
    ].map((user) => userToEntity(augmentUserWithDmActivity(user)));
  });

  const pinnedUsers = usePinnedContactUsers(
    props.selectedOptions,
    () =>
      allowsEntityType(props.config.specificEntityType, 'USER') &&
      !props.config.users
  );

  // Convert quickAccess items to CombinedEntity format.
  const entities = createMemo((): CombinedEntity[] => {
    const scoped = scopedUserEntities();
    if (scoped) return scoped;
    const specificEntityType = props.config.specificEntityType;

    // For THREAD type, use email data (not in quickAccess yet)
    if (specificEntityType === 'THREAD') {
      return emails().map(threadMapper);
    }

    // Convert quickAccess items to CombinedEntity
    const items = quickAccessItems();
    const additionalUsers = [
      ...new Map(
        [
          ...(specificEntityType === 'USER'
            ? (props.config.additionalUsers?.() ?? [])
            : []),
          ...pinnedUsers(),
        ].map((user) => [user.id, user])
      ).values(),
    ];
    const converted: CombinedEntity[] = additionalUsers.map(userToEntity);
    const additionalIds = new Set(additionalUsers.map((user) => user.id));

    for (const item of items) {
      if (additionalIds.has(item.id)) continue;
      // Augment users with DM activity
      if (item.kind === 'user') {
        const augmentedUser = augmentUserWithDmActivity(item.data);
        converted.push(userToEntity(augmentedUser));
      } else {
        const entity = quickAccessItemToEntity(item);
        const entityType = getEntityType(entity);
        const matches =
          !specificEntityType ||
          (Array.isArray(specificEntityType)
            ? entityType && specificEntityType.includes(entityType)
            : entityType === specificEntityType);
        if (entityType && matches) {
          converted.push(entity);
        }
      }
    }

    // Where threads are one of the allowed kinds, add the email browse list.
    if (allowsEntityType(specificEntityType, 'THREAD')) {
      const listed = new Set(converted.map((entity) => entity.id));
      converted.push(
        ...emails()
          .map(threadMapper)
          .filter((entity) => !listed.has(entity.id))
      );
    }

    return converted;
  });

  const customEmail = createMemo(() => {
    if (!props.config.allowCustomEmail) return undefined;
    const raw = inputValue().trim();
    if (!EmailValidator.validate(raw)) return undefined;
    const lower = raw.toLowerCase();
    const alreadyListed = entities().some(
      (entity) =>
        entity.kind === 'user' && entity.data.email.toLowerCase() === lower
    );
    if (alreadyListed) return undefined;
    return raw;
  });

  const customEmailEntity = (): CombinedEntity | undefined => {
    const email = customEmail();
    if (!email) return undefined;
    return userToEntity({ id: emailToId(email), email, name: email });
  };

  const rosterSearch = createRosterSearch(currentUserDomain, currentUserId);
  const entitySearch = createFreshSearch<CombinedEntity>({
    config: createEntitySearchConfig(currentUserDomain, currentUserId),
    getName: getEntitySearchText,
    isChannelItem: isChannelEntity,
    getTimestamp: getEntityTimestampedItem,
  });

  const filteredEntities = createMemo(() => {
    const term = search();
    const excludedIds = props.config.excludedIds?.();
    const allEntities = entities().filter(
      (entity) => !excludedIds?.has(entity.id)
    );
    const userId = currentUserId();

    // Keep explicit rosters bounded; query-backed pages grow only on request.
    const maxLocalResults = getMaxLocalResults(
      props.config.specificEntityType === 'USER' && !!props.config.users,
      !!term,
      allEntities.length +
        serverEmails().length +
        serverCompanyEntities().length
    );

    // Filter out the current entity when selecting same entity type
    const blockId = selfFilterBlockId();
    const currentEntityType = selfFilterEntityType();
    const excludeFilter = blockId
      ? (e: CombinedEntity) =>
          !(getEntityType(e) === currentEntityType && e.id === blockId)
      : () => true;

    const address = inputValue().trim();
    if (props.config.allowCustomEmail && EmailValidator.validate(address)) {
      // A complete address is an identity, not a display-name alias. It must
      // never redirect a calendar invitation to another person's mailbox.
      return allEntities
        .filter(excludeFilter)
        .filter(
          (entity) =>
            entity.kind === 'user' &&
            entity.data.email.toLowerCase() === address.toLowerCase()
        );
    }

    if (props.config.specificEntityType === 'USER' && !props.config.users) {
      const eligible = allEntities.filter(excludeFilter);
      const byId = new Map(eligible.map((entity) => [entity.id, entity]));
      const page = quickAccessItems().flatMap((item) => {
        const entity = byId.get(item.id);
        return entity ? [entity] : [];
      });
      const pageIds = new Set(page.map((entity) => entity.id));
      const extras = eligible.filter((entity) => !pageIds.has(entity.id));
      // Selected/scoped extras remain independent; personal windows retain the
      // storage order and eligibility rather than being rescored or capped.
      return [
        ...page,
        ...(term ? entitySearch(extras, term).map(({ item }) => item) : extras),
      ];
    }

    const eligibleById = new Map(
      allEntities.filter(excludeFilter).map((entity) => [entity.id, entity])
    );
    const personal = quickAccessItems().flatMap((item) => {
      if (item.kind !== 'user' || item.personOrder === undefined) return [];
      const entity = eligibleById.get(item.id);
      return entity ? [entity] : [];
    });
    // Get visible entities based on search
    // Sort self to top BEFORE slicing to ensure self appears even if not in top 50 by default
    let localResults: CombinedEntity[];
    if (term && props.config.users) {
      localResults = capPeople(
        rankAgentsAfterPeople(
          rosterSearch(allEntities.filter(excludeFilter), term),
          (entity) => entity.id
        ),
        (entity) => entity.id,
        maxLocalResults
      );
    } else if (term) {
      localResults = entitySearch(allEntities, term)
        .slice(0, maxLocalResults)
        .map((result) => result.item)
        .filter(excludeFilter);
    } else {
      const ordered = sortEntitiesWithSelfFirst(
        allEntities.filter(excludeFilter),
        userId
      );
      localResults = props.config.users
        ? capPeople(ordered, (entity) => entity.id, maxLocalResults)
        : ordered.slice(0, maxLocalResults);
    }

    // Server matches (email threads, companies) follow the local results.
    const serverMatches = term
      ? [
          ...(needsEmailSearch() ? serverEmails() : []),
          ...serverCompanyEntities(),
        ]
      : [];
    if (serverMatches.length > 0 || (needsEmailSearch() && term)) {
      const localIds = new Set(localResults.map((e) => e.id));
      const serverResults = serverMatches
        .filter((entity) => !excludedIds?.has(entity.id))
        .filter((e) => !localIds.has(e.id))
        .filter(excludeFilter);
      return preserveOrderedWindow(
        [...localResults, ...serverResults].slice(0, maxLocalResults),
        personal,
        (entity) => entity.id
      );
    }

    return preserveOrderedWindow(localResults, personal, (entity) => entity.id);
  });

  // Sort entities with selected items first when not searching. Self is
  // already pinned to the top within `filteredEntities`; this layers
  // selected-first on top of that ordering.
  const sortedEntities = useSelectedFirst({
    items: filteredEntities,
    allItems: entities,
    selectedIds: () => openedSelectedIds,
    searchQuery: search,
    getId: (e: CombinedEntity) => e.id,
  });

  const toggleEntity = (entity: CombinedEntity, custom = false) => {
    const entityType = getEntityType(entity);
    if (!entityType) return;
    const newSelected = new Set(props.selectedOptions());
    const isCurrentlySelected = newSelected.has(entity.id);

    if (props.config.isMultiSelect) {
      if (isCurrentlySelected) {
        newSelected.delete(entity.id);
      } else {
        newSelected.add(entity.id);
      }
    } else {
      newSelected.clear();
      if (!isCurrentlySelected) newSelected.add(entity.id);
    }

    if (!isCurrentlySelected && entity.kind === 'user') {
      props.onUserSelected?.(
        {
          id: entity.data.id,
          email: entity.data.email,
          name: entity.data.name,
        },
        custom
      );
    }
    props.setSelectedOptions(newSelected, [
      {
        id: entity.id,
        entity_type: entityType,
        name: getEntityName(entity),
      },
    ]);

    if (!props.config.isMultiSelect && props.onClose) {
      props.onClose();
    } else if (props.config.isMultiSelect && searchInputRef) {
      setInputValue('');
      setSearchTerm('');
      setTimeout(() => searchInputRef.focus(), 0);
    }
  };

  const resultCount = () => sortedEntities().length + (customEmail() ? 1 : 0);

  // Hold the row the user moved to by identity while pages are added around
  // it; a new search releases it.
  const highlight = createSelectionAnchor({
    items: sortedEntities,
    key: (entity) => entity.id,
    scope: search,
    selectedIndex,
    setSelectedIndex,
  });
  // A new search moves the highlight and the list to the top; a further page
  // listed below keeps both where the user put them.
  createEffect(
    on(
      search,
      () => {
        setSelectedIndex(0);
        if (scrollContainerRef) scrollContainerRef.scrollTop = 0;
      },
      { defer: true }
    )
  );
  let previousWindow: string | undefined;
  createEffect(
    on(quickAccess.windowKey, (key) => {
      if (!key) return;
      if (previousWindow && key !== previousWindow) {
        setSelectedIndex(0);
        if (scrollContainerRef) scrollContainerRef.scrollTop = 0;
      }
      previousWindow = key;
    })
  );
  const loadNext = () => fireAndForget(loadNextPages(), 'property-picker');
  // Read each failed source again: a failed later email page is the next one
  // still to fetch, and a failed first page is read from the start.
  const retryEmailPages = (query: {
    data?: unknown[];
    error: unknown;
    fetchNextPage: () => Promise<unknown>;
    refetch: () => Promise<unknown>;
  }) => {
    if (!query.error) return undefined;
    return query.data?.length ? query.fetchNextPage() : query.refetch();
  };
  const retryPages = () =>
    fireAndForget(
      Promise.all([
        quickAccess.error() ? quickAccess.retry() : undefined,
        contactSearchEnabled() && serverContacts.error()
          ? serverContacts.retry()
          : undefined,
        companySearchEnabled() && serverCompanies.error()
          ? serverCompanies.retry()
          : undefined,
        needsEmailSearch() ? retryEmailPages(emailsQuery) : undefined,
        emailSearchEnabled() ? retryEmailPages(emailSearchQuery) : undefined,
      ]),
      'property-picker'
    );
  // Further pages load as the end of the list scrolls into view. With no rows
  // listed, the sentinel sits below the empty list and keeps reading pages
  // until one matches or the sources end. A failed page waits for Retry. The
  // sentinel opts out of scroll anchoring: as the anchor, it would be held in
  // view while each page lands above it, and every page would load the next.
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  useInfiniteScrollSentinel({
    sentinel,
    hasNextPage: () => hasMore() && !paginationError(),
    isFetchingNextPage: isLoadingMore,
    fetchNextPage: loadNext,
  });

  // Scroll the selected row into view during keyboard navigation
  createEffect(() => {
    const index = selectedIndex();
    if (!keyboardMode() || !scrollContainerRef) return;
    const row = scrollContainerRef.querySelector<HTMLDivElement>(
      `[data-entity-index="${index}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      (props.onCancel ?? props.onClose)?.();
      return;
    }
    if (e.key === 'PageDown' && hasMore()) {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoadingMore()) loadNext();
      return;
    }
    const total = resultCount();
    if (total === 0) return;

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (Math.min(prev, total - 1) + 1) % total);
      highlight.hold();
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (Math.min(prev, total - 1) - 1 + total) % total
      );
      highlight.hold();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = Math.min(selectedIndex(), total - 1);
      if (idx < sortedEntities().length) {
        const entity = sortedEntities()[idx];
        if (entity) toggleEntity(entity);
      } else {
        const entity = customEmailEntity();
        if (entity) toggleEntity(entity, true);
      }
    }
    if (e.defaultPrevented) e.stopPropagation();
  };

  useSearchInputFocus(() => searchInputRef);

  const fills = () => props.config.fillHeight === true;
  const inSheet = () => props.presentation === 'sheet';
  const keepSearchFocus = (event: Event) => event.preventDefault();

  const selectedEntityCountAtOpen = createMemo(() => {
    if (!props.config.isMultiSelect || searchTerm()) return 0;

    return sortedEntities().filter((entity) =>
      openedSelectedIds.includes(entity.id)
    ).length;
  });
  const shouldShowSelectedDivider = (index: number) => {
    const selectedCount = selectedEntityCountAtOpen();
    if (selectedCount === 0) return false;
    if (selectedCount === sortedEntities().length) return false;

    return index === selectedCount;
  };

  return (
    <div class={cn(fills() && 'flex min-h-0 flex-1 flex-col')}>
      <div class="relative shrink-0">
        <div
          class={cn(
            'flex w-full items-center gap-2',
            inSheet() ? 'px-4 pb-4' : 'py-2 px-2 border-b border-edge-muted'
          )}
        >
          <Show when={!inSheet()}>
            <SearchIcon class="size-4 text-ink-muted" />
          </Show>
          <input
            class={
              inSheet()
                ? inputClasses({ class: 'min-h-11' })
                : 'w-full caret-accent'
            }
            aria-label={props.config.placeholder}
            ref={searchInputRef}
            type="text"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            // Handle picker navigation before the enclosing dropdown consumes it.
            onKeyDown={handleKeyDown}
            placeholder={props.config.placeholder}
          />
        </div>
      </div>
      <Show when={resultCount() > 0}>
        {/* Picking a row keeps focus in the search field: a tap that moved
          it would drop the phone keyboard until the refocus below. iOS
          devices still send mousedown after a cancelled pointerdown. */}
        <div
          class={cn(
            inSheet() ? 'px-4' : 'p-1.5',
            fills() && 'flex min-h-0 flex-1 flex-col'
          )}
          onPointerDown={keepSearchFocus}
          onMouseDown={keepSearchFocus}
        >
          <Show when={sortedEntities().length > 0}>
            <div
              ref={scrollContainerRef}
              style={{
                'max-height': fills() ? undefined : `${MAX_LIST_HEIGHT}px`,
              }}
              class={cn(
                'overflow-y-auto overflow-x-hidden scrollbar-hidden',
                fills() && 'min-h-0 flex-1'
              )}
            >
              <For each={sortedEntities()}>
                {(entity, index) => {
                  const isSelected = () =>
                    props.selectedOptions().has(entity.id);
                  const isKeyboardSelected = () => index() === selectedIndex();

                  return (
                    <>
                      <Show
                        when={!inSheet() && shouldShowSelectedDivider(index())}
                      >
                        <div class="my-1 border-t border-edge-muted" />
                      </Show>
                      <div
                        data-entity-index={index()}
                        role={inSheet() ? 'checkbox' : undefined}
                        aria-checked={inSheet() ? isSelected() : undefined}
                        tabIndex={inSheet() ? 0 : undefined}
                        class="group rounded-lg w-full flex items-center justify-between gap-1.5 p-1.5 px-2 text-left text-ink font-normal cursor-default min-w-0 touch:min-h-12"
                        classList={{
                          'bg-hover': isKeyboardSelected(),
                        }}
                        onClick={() => toggleEntity(entity)}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' ||
                            (inSheet() && event.key === ' ')
                          ) {
                            event.preventDefault();
                            toggleEntity(entity);
                          }
                        }}
                        onMouseEnter={() => {
                          if (!keyboardMode()) {
                            setSelectedIndex(index());
                            highlight.hold();
                          }
                        }}
                      >
                        <Show when={props.config.isMultiSelect}>
                          <div class="shrink-0 flex">
                            <Show
                              when={inSheet()}
                              fallback={
                                <OptionCheckBox
                                  checked={isSelected()}
                                  multiselect
                                  visible={props.config.visibleCheckboxes}
                                />
                              }
                            >
                              <InlineCheckbox
                                checked={isSelected()}
                                size="md"
                              />
                            </Show>
                          </div>
                        </Show>
                        <div class="flex items-center gap-2 flex-1 min-w-0">
                          <div class="size-4 shrink-0 flex items-center">
                            <Show
                              when={entity.kind === 'entity'}
                              fallback={
                                <UserIcon
                                  id={entity.id}
                                  name={
                                    entity.kind === 'user'
                                      ? entity.data.name
                                      : undefined
                                  }
                                  size="sm"
                                  isDeleted={false}
                                  suppressClick={true}
                                  photoUrl={
                                    entity.kind === 'user'
                                      ? entity.data.photoUrl
                                      : undefined
                                  }
                                />
                              }
                            >
                              <Entity.Icon entity={entity.data as EntityData} />
                            </Show>
                          </div>
                          <span class="truncate min-w-0 max-w-full">
                            <Show
                              when={entity.kind === 'entity'}
                              fallback={
                                <Show
                                  when={getUserEntityParts(entity)}
                                  fallback={getEntityName(entity)}
                                >
                                  {(parts) => (
                                    <>
                                      {parts().name}
                                      <Show when={parts().email}>
                                        {/* An en space is the 0.5em gap; unlike a margin, Safari's truncated-text tooltip keeps it. */}
                                        {' '}
                                        <span class="opacity-50">
                                          {parts().email}
                                        </span>
                                      </Show>
                                    </>
                                  )}
                                </Show>
                              }
                            >
                              <Entity.Title
                                entity={entity.data as EntityData}
                              />
                            </Show>
                          </span>
                          <Show when={isBotPrincipalId(entity.id)}>
                            <span class="shrink-0 text-xs text-ink-muted">
                              Agent
                            </span>
                          </Show>
                        </div>
                        <Show
                          when={!props.config.isMultiSelect && isSelected()}
                        >
                          <CheckIcon class="size-3.5 shrink-0 text-accent" />
                        </Show>
                      </div>
                    </>
                  );
                }}
              </For>
              <Show when={hasMore()}>
                <div ref={setSentinel} class="h-px [overflow-anchor:none]" />
              </Show>
            </div>
          </Show>
          <Show when={customEmail()}>
            {(email) => {
              const rowIndex = () => sortedEntities().length;
              const entity = () => customEmailEntity();
              return (
                <div
                  class="group rounded-lg w-full flex items-center justify-between gap-1.5 p-1.5 px-2 text-left text-ink font-normal cursor-default min-w-0 touch:min-h-12"
                  classList={{
                    'bg-hover': rowIndex() === selectedIndex(),
                  }}
                  onClick={() => {
                    const next = entity();
                    if (next) toggleEntity(next, true);
                  }}
                  onMouseEnter={() => {
                    if (!keyboardMode()) setSelectedIndex(rowIndex());
                  }}
                >
                  <Show when={props.config.isMultiSelect}>
                    <div class="shrink-0">
                      <OptionCheckBox checked={false} multiselect />
                    </div>
                  </Show>
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div class="size-4 shrink-0 flex items-center">
                      <UserIcon
                        id={emailToId(email())}
                        name={email()}
                        size="sm"
                        isDeleted={false}
                        suppressClick={true}
                      />
                    </div>
                    <span class="truncate min-w-0">Add {email()}</span>
                  </div>
                </div>
              );
            }}
          </Show>
        </div>
      </Show>

      <Show when={paginationError()}>
        <div role="status" class="px-2 py-2 text-xs text-ink-muted">
          {t('common.optionsUnavailable')}
        </div>
      </Show>
      <Show when={resultCount() === 0 && !paginationError()}>
        {props.emptyState !== undefined ? (
          props.emptyState
        ) : (
          <div class="text-center py-4 text-ink-muted text-sm">
            <Show
              when={!isLoadingEntities() && !hasMore()}
              fallback={<span>Loading...</span>}
            >
              {props.config.emptyMessage ??
                `No ${getEntityTypePluralLabel(props.config.specificEntityType)} found`}
            </Show>
          </div>
        )}
      </Show>
      <Show when={sortedEntities().length === 0 && hasMore()}>
        <div ref={setSentinel} class="h-px [overflow-anchor:none]" />
      </Show>
      <Show when={isLoadingMore()}>
        <div role="status" class="px-2 py-2 text-xs text-ink-muted">
          {t('common.loadingOptions')}
        </div>
      </Show>
      <Show when={paginationError()}>
        <Button
          variant="ghost"
          class="w-full"
          disabled={isLoadingMore()}
          onPointerDown={(event) => event.preventDefault()}
          onClick={retryPages}
        >
          {t('viewMenus.retryOptions')}
        </Button>
      </Show>
    </div>
  );
}
