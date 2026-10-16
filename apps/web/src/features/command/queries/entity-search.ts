import {
  type Bucket,
  type QuickAccessItem,
  useQuickAccess,
} from '@core/context/quickAccess';
import { exclude } from '@core/context/quickAccess/types';
import { useUserId } from '@core/context/user';
import { type Accessor, createMemo } from 'solid-js';
import { contactCommandItems } from '../contact-items';
import {
  type ProjectCommandItem,
  useProjectCommandItems,
} from '../project-items';
import { rankCommandSearchItems } from '../rank-command-search-items';
import type { CategoryFilter } from '../types';
import type { CommandContactSource, CommandMenuItem } from '../useCommandItems';

export type EntitySearchCategory =
  | Exclude<CategoryFilter, 'commands'>
  | 'email';
export type EntitySearchItem = QuickAccessItem | ProjectCommandItem;

const QUICK_ACCESS_BUCKETS_BY_CATEGORY: Partial<
  Record<EntitySearchCategory, Bucket[]>
> = {
  all: exclude('person', 'initiative', 'crm_contact'),
  email: ['email'],
  channels: ['channel'],
  dms: ['dm'],
  documents: ['note', 'document', 'snippet', 'project', 'database', 'form'],
  tasks: ['task'],
  chats: ['chat'],
  people: ['person'],
};
const CONTACT_CATEGORIES = new Set<EntitySearchCategory | 'commands'>([
  'all',
  'dms',
  'people',
]);

function showInRecencyList(item: CommandMenuItem): boolean {
  return item.bucket !== 'crm_company' || item.timestamps.viewedAt != null;
}

/** Shared entity composition; desktop commands and session state stay with their host. */
export function useEntitySearch(
  query: Accessor<string>,
  categoryFilter: Accessor<EntitySearchCategory | 'commands'>,
  options: {
    enabled: Accessor<boolean>;
    excludeEmails?: boolean;
    contactDiscovery?: (
      search: Accessor<string>,
      active: Accessor<boolean>
    ) => CommandContactSource;
  }
) {
  const quickAccess = useQuickAccess();
  const searchActive = options.enabled;
  const scopedSearchTerm = () => (searchActive() ? query() : '');
  const activeList = createMemo(() => {
    if (!searchActive()) return;
    const category = categoryFilter();
    const buckets =
      category === 'commands'
        ? undefined
        : QUICK_ACCESS_BUCKETS_BY_CATEGORY[category];
    if (!buckets) return;
    return quickAccess.useList({
      buckets: options.excludeEmails
        ? buckets.filter((bucket) => bucket !== 'email')
        : buckets,
      searchTerm: scopedSearchTerm,
      enabled: searchActive,
    });
  });
  const projectEnabled = () =>
    searchActive() &&
    (categoryFilter() === 'all' || categoryFilter() === 'projects');
  const projects = useProjectCommandItems(scopedSearchTerm, projectEnabled);
  const contactsActive = () =>
    searchActive() &&
    CONTACT_CATEGORIES.has(categoryFilter()) &&
    query().trim().length > 0;
  const contacts = options?.contactDiscovery?.(
    scopedSearchTerm,
    contactsActive
  );
  const contactPeople = contacts
    ? {
        users: quickAccess.useList('person').items,
        directMessages: quickAccess.useList('dm').items,
        viewerId: useUserId(),
      }
    : undefined;
  const contactItems = createMemo((): EntitySearchItem[] =>
    contacts && contactPeople && contactsActive()
      ? contactCommandItems({
          contacts: contacts.contacts(),
          users: contactPeople.users(),
          directMessages: contactPeople.directMessages(),
          viewerId: contactPeople.viewerId(),
        })
      : []
  );
  const contactItemIds = createMemo(
    () => new Set(contactItems().map((item) => item.id))
  );
  const cachedItems = (): EntitySearchItem[] => activeList()?.items() ?? [];
  const withDiscovery = <T extends CommandMenuItem>(
    baseItems: T[]
  ): (T | EntitySearchItem)[] => {
    const items = [...baseItems, ...projects.items()];
    // A contact's row keeps its CRM name searchable, so it replaces the same
    // conversation listed under its own name.
    const contactIds = contactItemIds();
    if (contactIds.size === 0) return items;
    return [
      ...items.filter((item) => !contactIds.has(item.id)),
      ...contactItems(),
    ];
  };

  const rankItems = <T extends CommandMenuItem>(
    items: T[],
    queryText: string
  ): T[] => {
    if (!queryText.trim()) return items.filter(showInRecencyList);
    return rankCommandSearchItems(items, queryText, {
      preserveAdditionalEntityMatches:
        quickAccess.usesRecordSelection() || quickAccess.usesSearchProjection(),
      preservedIds: contactItemIds(),
    });
  };

  return {
    items: () => withDiscovery(cachedItems()),
    cachedItems,
    withDiscovery,
    rankItems,
    projectsEnabled: projects.enabled,
    isLoadingEntities: () =>
      (!!activeList()?.isLoading() && activeList()?.items().length === 0) ||
      projects.isLoading() ||
      (contactsActive() && (contacts?.isLoading() ?? false)),
    pagination: {
      hasMore: () =>
        (activeList()?.hasMore() ?? false) ||
        projects.hasMore() ||
        (contactsActive() && (contacts?.hasMore() ?? false)),
      isLoadingMore: () =>
        (activeList()?.isLoadingMore() ?? false) ||
        projects.isLoadingMore() ||
        (contactsActive() && (contacts?.isLoadingMore() ?? false)),
      loadMore: async () => {
        await Promise.all([
          activeList()?.loadMore(),
          projects.loadMore(),
          contactsActive() ? contacts?.loadMore() : undefined,
        ]);
      },
    },
  };
}
