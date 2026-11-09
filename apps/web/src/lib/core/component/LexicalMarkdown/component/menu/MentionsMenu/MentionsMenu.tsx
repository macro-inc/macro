import { useCrmContactMentionSource } from '@app/features/crm/record-adapter';
import { externalChatApi } from '@app/features/external-chat/queries/production-api';
import { useRoutineMentionSource } from '@app/features/routines/routine-mentions';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  enableCrm,
  enableWhatsappLinked,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import {
  type EntityBucket,
  type EntityItem,
  useQuickAccess,
} from '@core/context/quickAccess';
import { deduplicateContactItems } from '@core/context/quickAccess/crm-contacts';
import { useUserId } from '@core/context/user';
import clickOutside from '@core/directive/clickOutside';
import { isMobile } from '@core/mobile/isMobile';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { Telemetry } from '@macro-inc/observability';
import { useExternalChatsQuery } from '@queries/external-chats';
import { queryReadyGate } from '@queries/gate';
import { Key } from '@solid-primitives/keyed';
import { createLazyMemo } from '@solid-primitives/memo';
import { Surface } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { floatWithElement } from '../../../directive/floatWithElement';
import { floatWithSelection } from '../../../directive/floatWithSelection';
import { CLOSE_INLINE_SEARCH_COMMAND } from '../../../plugins';
import type {
  AgentSessionMentionItem,
  DateMentionItem,
  ExternalChatMentionItem,
  MentionItem,
} from '../../../utils/mentionsUtils';
import { useMenuKeyboardNavigation } from '../useMenuKeyboardNavigation';
import { ItemBin } from './components/ItemBin';
import { MentionsMenuItem } from './components/MentionsMenuItem';
import { VirtualizedItemList } from './components/VirtualizedItemList';
import { createMentionPageLoader } from './hooks/createMentionPageLoader';
import { useBookingLinkMention } from './hooks/useBookingLinkMention';
import { useCalendarEventMention } from './hooks/useCalendarEventMention';
import { useEmailSearchMention } from './hooks/useEmailSearchMention';
import {
  useEntityMention,
  useEntityMentionFromList,
} from './hooks/useEntityMention';
import { useUsersMention } from './hooks/useUsersMention';
import type { BucketConfig, MentionBucketId } from './MentionsMenuController';
import { useMentionsMenuController } from './MentionsMenuController';
import { presentMentionsNatively } from './native-presentation';
import type { MentionsMenuProps } from './props';
import { rankMentions } from './utils/mention-ranking';
import { createItemHandler } from './utils/mentionHandlers';
import { sortMobileMentions } from './utils/mobileSort';

const TARGET_ITEMS = 8;
// Height consumed by Surface's p-px border (2px) + py-2 padding (16px)
const PANEL_DECORATION_HEIGHT = 18;
const MAX_CONTENT_HEIGHT = 256;
const DEFAULT_DOCUMENT_BUCKETS: EntityBucket[] = [
  'note',
  'task',
  'snippet',
  'document',
  'project',
  'chat',
  'database',
  'form',
  'initiative',
];

export function MentionsMenu(props: MentionsMenuProps) {
  return (
    <Suspense>
      <MentionsMenuInner {...props} />
    </Suspense>
  );
}

function MentionsMenuInner(props: MentionsMenuProps) {
  const analytics = useAnalytics();

  const searchTerm = debouncedDependent(props.menu.searchTerm, 60);
  const activeSearchTerm = () => (props.menu.isOpen() ? searchTerm() : '');

  const hasCustomEntities = () => !!props.entities;
  const sessionsEnabled = () =>
    !hasCustomEntities() &&
    (!props.sources || props.sources.includes('agentSessions'));
  const quickAccess = hasCustomEntities() ? undefined : useQuickAccess();
  const sessionList = quickAccess?.useList({
    buckets: ['agent_session'],
    searchTerm: activeSearchTerm,
    enabled: sessionsEnabled,
  });
  const agentSessions = createLazyMemo((): AgentSessionMentionItem[] =>
    (sessionList?.items() ?? []).map((item) => ({
      ...item,
      kind: 'agentSession',
    }))
  );

  const allItems = props.entities ?? quickAccess!.useList().items;

  const { isKeypressActive } = useIsKeyPressActive();

  const legacyBlockId = useMaybeBlockId();
  const blockId = props.sourceDocumentId ?? legacyBlockId;

  const {
    usersAndGroups,
    groups,
    isLoading: isLoadingUsers,
    error: errorUsers,
  } = useUsersMention({
    users: props.users,
    searchTerm,
    isChannelBlock: props.block === 'channel',
  });

  const customDocs = props.entities
    ? useEntityMentionFromList({
        items: props.entities,
        buckets: props.documentBuckets ?? DEFAULT_DOCUMENT_BUCKETS,
        searchTerm,
      })
    : undefined;

  const customChannels = props.entities
    ? useEntityMentionFromList({
        items: props.entities,
        buckets: ['channel', 'dm'],
        searchTerm,
      })
    : undefined;

  const customCompanies =
    isFeatureEnabled(enableCrm) && props.entities
      ? useEntityMentionFromList({
          items: props.entities,
          buckets: ['crm_company'],
          searchTerm,
        })
      : undefined;

  const docsMention =
    customDocs ??
    useEntityMention({
      buckets: props.documentBuckets ?? DEFAULT_DOCUMENT_BUCKETS,
      searchTerm: activeSearchTerm,
    });
  const docs = docsMention.entities;

  const channelsMention =
    customChannels ??
    useEntityMention({
      buckets: ['channel', 'dm'],
      searchTerm: activeSearchTerm,
    });
  const channels = channelsMention.entities;

  // CRM companies only surface in mentions when the feature is enabled —
  // the mention hook isn't even wired up otherwise.
  const companyMention = isFeatureEnabled(enableCrm)
    ? (customCompanies ??
      useEntityMention({
        buckets: ['crm_company'],
        searchTerm: activeSearchTerm,
      }))
    : undefined;
  const sourceEnabled = (source: MentionBucketId) =>
    !props.sources || props.sources.includes(source);
  const contactsEnabled = () =>
    props.includeContacts !== false && sourceEnabled('crm');
  const contactMention = isFeatureEnabled(enableCrm)
    ? props.entities
      ? useEntityMentionFromList({
          items: props.entities,
          buckets: ['crm_contact'],
          searchTerm,
        })
      : useCrmContactMentionSource(
          activeSearchTerm,
          () => props.menu.isOpen() && contactsEnabled()
        )
    : undefined;

  const crmItems = createLazyMemo(() =>
    rankMentions(
      deduplicateContactItems([
        ...(companyMention?.entities() ?? []),
        ...(contactsEnabled() ? (contactMention?.entities() ?? []) : []),
      ]),
      searchTerm(),
      true
    )
  );
  const crmMention = {
    isLoading: () =>
      (companyMention?.isLoading() ?? false) ||
      (contactsEnabled() && (contactMention?.isLoading() ?? false)),
    error: () =>
      companyMention?.error() ??
      (contactsEnabled() ? contactMention?.error() : undefined),
    entities: crmItems,
    totalCount: () => crmItems().length,
    hasMore: () =>
      (companyMention?.hasMore() ?? false) ||
      (contactsEnabled() && (contactMention?.hasMore() ?? false)),
    isLoadingMore: () =>
      (companyMention?.isLoadingMore() ?? false) ||
      (contactsEnabled() && (contactMention?.isLoadingMore() ?? false)),
    loadMore: async () => {
      await Promise.all([
        companyMention?.loadMore(),
        contactsEnabled() && contactMention?.loadMore(),
      ]);
    },
  };

  const {
    emails,
    isLoading: isLoadingEmails,
    error: errorEmails,
    totalCount: totalEmailCount,
    hasMore: hasMoreEmails,
    isLoadingMore: isLoadingMoreEmails,
    loadMore: loadMoreEmails,
  } = hasCustomEntities()
    ? {
        emails: () => [],
        isLoading: () => false,
        error: () => undefined,
        totalCount: () => 0,
        hasMore: () => false,
        isLoadingMore: () => false,
        loadMore: async () => {},
      }
    : useEmailSearchMention({
        searchTerm: activeSearchTerm,
        enabled: () => !props.sources || props.sources.includes('emails'),
      });

  // A WhatsApp chat mentioned in a channel is shared with its members; only
  // its owner can do that, so only the viewer's own chats are offered.
  const externalChatsEnabled = () =>
    !hasCustomEntities() &&
    props.block === 'channel' &&
    props.menu.isOpen() &&
    isFeatureEnabled(enableWhatsappLinked) &&
    (!props.sources || props.sources.includes('externalChats'));
  const userId = useUserId();
  const externalChatsQuery = useExternalChatsQuery(externalChatApi, () =>
    externalChatsEnabled() ? (userId() ?? '') : ''
  );
  const externalChats = createLazyMemo((): ExternalChatMentionItem[] => {
    if (!externalChatsEnabled() || !queryReadyGate(externalChatsQuery))
      return [];
    const term = searchTerm().trim().toLocaleLowerCase();
    return externalChatsQuery.data
      .filter(
        (chat) =>
          chat.ownerId === userId() &&
          chat.name.toLocaleLowerCase().includes(term)
      )
      .map((chat) => ({
        kind: 'externalChat',
        id: chat.id,
        data: { id: chat.id, name: chat.name, provider: chat.provider },
      }));
  });

  // Mentioning a routine in a channel shares it with the channel's members.
  const routines = useRoutineMentionSource(
    searchTerm,
    () =>
      !hasCustomEntities() &&
      props.block === 'channel' &&
      props.menu.isOpen() &&
      (!props.sources || props.sources.includes('routines'))
  );

  const dateOptions = useDateSearch({ query: searchTerm });
  const dates = createLazyMemo((): DateMentionItem[] => {
    return dateOptions().map(
      (option): DateMentionItem => ({
        kind: 'date',
        id: `date-${option.id}`,
        data: option,
      })
    );
  });

  // Every composer mounts this menu closed; fetch only once it opens.
  const bookingLinksEnabled = () =>
    props.menu.isOpen() &&
    !hasCustomEntities() &&
    (!props.sources || props.sources.includes('bookingLinks'));
  const {
    bookingLinks,
    isLoading: isLoadingBooking,
    error: errorBooking,
  } = useBookingLinkMention({
    enabled: bookingLinksEnabled,
    searchTerm,
  });
  const {
    events: calendarEvents,
    isLoading: isLoadingCalendar,
    error: errorCalendar,
  } = useCalendarEventMention({
    enabled: () =>
      props.menu.isOpen() &&
      !hasCustomEntities() &&
      (!props.sources || props.sources.includes('calendarEvents')),
    searchTerm,
  });

  const openTabs = createLazyMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return [];

    const splits = splitManager.splits();
    const allItems_ = allItems();

    const tabItems: EntityItem[] = [];
    const seenKeys = new Set<string>();

    for (const split of splits) {
      if (
        split.content.type === 'component' ||
        (props.block === 'chat' &&
          !SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(split.content.type))
      ) {
        continue;
      }

      if (split.content.id === blockId) continue;

      const key = `${split.content.type}:${split.content.id}`;
      if (seenKeys.has(key)) continue;

      seenKeys.add(key);

      const item = allItems_.find((item) => item.id === split.content.id);
      if (!item || item.kind !== 'entity') continue;
      tabItems.push(item);
    }

    return tabItems;
  });

  const [menuOpen, setMenuOpen] = [props.menu.isOpen, props.menu.setIsOpen];

  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    controller.selectItem(index);
  };

  const [mountSelection, setMountSelection] = createSignal<Selection | null>();

  const mentionUsers = () =>
    (usersAndGroups() ?? []).filter(
      (item) => props.includeGroups !== false || item.kind !== 'group'
    );
  const mobileAllItems = createLazyMemo((): MentionItem[] => {
    const users = sourceEnabled('users') ? mentionUsers() : [];
    const combined: MentionItem[] = [
      ...(sourceEnabled('bookingLinks') ? bookingLinks() : []),
      ...users,
      ...(sourceEnabled('documents') ? (docs() ?? []) : []),
      ...(sourceEnabled('channels') ? (channels() ?? []) : []),
      ...externalChats(),
      ...routines(),
      ...(sourceEnabled('agentSessions') ? agentSessions() : []),
      ...(sourceEnabled('crm') ? crmMention.entities() : []),
      ...(sourceEnabled('emails') ? (emails() ?? []) : []),
      ...(sourceEnabled('calendarEvents') ? calendarEvents() : []),
      ...(sourceEnabled('dates') ? (dates() ?? []) : []),
    ];
    return sortMobileMentions(combined, searchTerm(), users, true);
  });

  const bucketConfigs = createLazyMemo((): BucketConfig[] => {
    // Binning and pagination read these eagerly, outside the menu's Show.
    // Keep closed composers from gathering and ranking mention candidates.
    if (!menuOpen()) return [];

    if (isMobile()) {
      return [
        {
          id: 'all',
          label: 'All',
          getData: mobileAllItems,
          getFullCount: () =>
            (sourceEnabled('bookingLinks') ? bookingLinks().length : 0) +
            (sourceEnabled('users') ? mentionUsers().length : 0) +
            (sourceEnabled('documents') ? docsMention.totalCount() : 0) +
            (sourceEnabled('agentSessions') ? agentSessions().length : 0) +
            (sourceEnabled('channels') ? channelsMention.totalCount() : 0) +
            externalChats().length +
            routines().length +
            (sourceEnabled('crm') ? crmMention.totalCount() : 0) +
            (sourceEnabled('emails') ? totalEmailCount() : 0) +
            (sourceEnabled('calendarEvents') ? calendarEvents().length : 0) +
            (sourceEnabled('dates') ? (dates()?.length ?? 0) : 0),
          hasMore: () =>
            (sourceEnabled('documents') && docsMention.hasMore()) ||
            (sourceEnabled('channels') && channelsMention.hasMore()) ||
            (sourceEnabled('crm') && crmMention.hasMore()) ||
            (sourceEnabled('emails') && hasMoreEmails()),
          isLoadingMore: () =>
            (sourceEnabled('documents') && docsMention.isLoadingMore()) ||
            (sourceEnabled('channels') && channelsMention.isLoadingMore()) ||
            (sourceEnabled('crm') && crmMention.isLoadingMore()) ||
            (sourceEnabled('emails') && isLoadingMoreEmails()),
          loadMore: async () => {
            await Promise.all([
              sourceEnabled('documents') && docsMention.loadMore(),
              sourceEnabled('channels') && channelsMention.loadMore(),
              sourceEnabled('crm') && crmMention.loadMore(),
              sourceEnabled('emails') && loadMoreEmails(),
            ]);
          },
        },
      ];
    }

    const buckets: BucketConfig[] = [
      {
        id: 'bookingLinks',
        label: 'Booking Links',
        getData: bookingLinks,
        getFullCount: () => bookingLinks().length,
      },
      {
        id: 'users',
        label:
          props.includeGroups !== false && groups().length > 0
            ? 'People & Groups'
            : 'People',
        getData: mentionUsers,
        getFullCount: () => mentionUsers().length,
      },
      {
        id: 'documents',
        label: 'Documents, Agents, & Tasks',
        getData: () => docs() ?? [],
        getFullCount: docsMention.totalCount,
        hasMore: docsMention.hasMore,
        isLoadingMore: docsMention.isLoadingMore,
        loadMore: docsMention.loadMore,
      },
      {
        id: 'channels',
        label: 'Channels',
        getData: () => channels() ?? [],
        getFullCount: channelsMention.totalCount,
        hasMore: channelsMention.hasMore,
        isLoadingMore: channelsMention.isLoadingMore,
        loadMore: channelsMention.loadMore,
      },
      {
        id: 'externalChats',
        label: 'WhatsApp chats',
        getData: externalChats,
        getFullCount: () => externalChats().length,
      },
      {
        id: 'routines',
        label: 'Routines',
        getData: routines,
        getFullCount: () => routines().length,
      },
      {
        id: 'agentSessions',
        label: 'Recent agent sessions',
        getData: agentSessions,
        getFullCount: () => agentSessions().length,
      },
      {
        id: 'crm',
        label: t('common.contactsAndCompanies'),
        getData: crmMention.entities,
        getFullCount: crmMention.totalCount,
        hasMore: crmMention.hasMore,
        isLoadingMore: crmMention.isLoadingMore,
        loadMore: crmMention.loadMore,
      },
      {
        id: 'emails',
        label: 'Emails',
        getData: () => emails() ?? [],
        getFullCount: totalEmailCount,
        hasMore: hasMoreEmails,
        isLoadingMore: isLoadingMoreEmails,
        loadMore: loadMoreEmails,
      },
      {
        id: 'calendarEvents',
        label: 'Calendar events',
        getData: calendarEvents,
        getFullCount: () => calendarEvents().length,
      },
      {
        id: 'dates',
        label: 'Dates',
        getData: () => dates() ?? [],
        getFullCount: () => dates()?.length ?? 0,
      },
    ];

    if (props.showOpenTabs) {
      buckets.unshift({
        id: 'openTabs',
        label: 'Open Tabs',
        getData: () => openTabs() ?? [],
        getFullCount: () => openTabs()?.length ?? 0,
      });
    }

    const sourcesFilter = props.sources;
    const filtered = sourcesFilter
      ? buckets.filter((bucket) => sourcesFilter.includes(bucket.id))
      : buckets;

    return filtered.filter((bucket) => bucket.getFullCount() > 0);
  });

  const controller = useMentionsMenuController(bucketConfigs, {
    ignoredIds: () => (blockId ? [blockId] : []),
    targetItems: TARGET_ITEMS,
  });

  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | null
  >('start');

  createEffect(() => {
    if (!menuOpen()) {
      setEscapeSpaceState('start');
      controller.reset();
    }
  });

  const itemActionHandler = props.editor
    ? createItemHandler({
        editor: props.editor,
        blockName: useMaybeBlockName(),
        blockId,
        onUserMention: props.onUserMention,
        onDocumentMention: props.onDocumentMention,
        onEmailMention: props.onEmailMention,
        disableMentionTracking: props.disableMentionTracking,
      })
    : undefined;

  /**
   * Agents whose runtime is away are listed but not pickable: a mention
   * inserted here would sit in the message unanswered until the machine comes
   * back, which reads as the agent ignoring you. The flag rides on the user
   * entry so this menu needs no view of runtimes.
   */
  const isOffline = (item: MentionItem) =>
    item.kind === 'user' && item.data.offline === true;

  const itemAction = async (item: MentionItem) => {
    if (isOffline(item)) return false;
    analytics.track('mentions_menu_use', { itemType: item.kind });
    if (props.onPick) props.onPick(item);
    else await itemActionHandler?.(item);
    return true;
  };

  createEffect(() => {
    if (props.anchor && !props.nativePresentation) return;
    if (menuOpen()) {
      setMountSelection(document.getSelection());
      controller.reset();
      if (isMobile()) {
        controller.viewAll('all');
      }
    } else {
      setMountSelection(null);
    }
  });

  const closeMenu = () => {
    props.editor?.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  // Phones only show the full list, so there is no grouped view to go back to.
  const canExitViewAll = () => controller.isViewAllMode() && !isMobile();

  useMenuKeyboardNavigation({
    isActive: () => !props.nativePresentation && menuOpen(),
    onUp: () => {
      controller.selectPrev();
    },
    onDown: () => {
      controller.selectNext();
    },
    onLeft: () => {
      if (canExitViewAll()) {
        controller.exitViewAll();
      }
    },
    onRight: () => {
      if (!controller.isViewAllMode()) {
        const currentCategory = controller.selectedCategory();
        if (currentCategory) {
          const category = controller.getBucket(currentCategory);
          if (
            controller.canViewAllForCategory(currentCategory) ||
            category?.hasMore?.()
          ) {
            controller.viewAll(currentCategory);
          }
        }
      }
    },
    onSelect: () => {
      const selectedItem = controller.selectedItem();
      // Keep the menu open on an offline agent so Enter reads as "not that
      // one" rather than silently dismissing with nothing inserted.
      if (selectedItem && isOffline(selectedItem)) return;
      if (selectedItem) {
        itemAction(selectedItem).catch((error) =>
          Telemetry.error(error, {
            surface: 'mentions-menu',
            itemKind: selectedItem.kind,
          })
        );
      } else {
        closeMenu();
      }
      props.menu.setSearchTerm('');
      setMenuOpen(false);
    },
    onClose: () => {
      if (canExitViewAll()) {
        controller.exitViewAll();
      } else {
        closeMenu();
      }
    },
    onSpace: () => {
      switch (escapeSpaceState()) {
        case 'single':
        case 'start':
          closeMenu();
          return true;
        case null:
          setEscapeSpaceState('single');
          return false;
      }
      return false;
    },
    onOtherKey: () => {
      setEscapeSpaceState(null);
    },
  });

  const focusOut = () => {
    closeMenu();
  };

  onMount(() => {
    if (props.nativePresentation) return;
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      document.removeEventListener('focusout', focusOut);
    });
  });

  const maybeLoadMentionPage = createMentionPageLoader();
  createEffect(() => {
    const items = controller.combinedItems();
    if (!items) return;

    const viewAllMode = controller.viewAllMode();
    const activeBucket = viewAllMode
      ? controller.getBucket(viewAllMode)
      : undefined;
    maybeLoadMentionPage({
      bucket: activeBucket,
      query: activeSearchTerm(),
      selectedIndex: controller.selectedIndex(),
      itemCount: items.length,
    });
    if (controller.selectedIndex() >= items.length) {
      controller.selectItem(items.length - 1);
    }
  });

  const handleViewAll = (binType: string) => {
    controller.viewAll(binType);
  };

  const handleBackToAll = () => {
    controller.exitViewAll();
  };

  const viewAllCategoryLabel = () => {
    const mode = controller.viewAllMode();
    if (!mode) return 'Items';
    const bucket = bucketConfigs().find((b) => b.id === mode);
    if (!bucket) return 'Items';
    return `${bucket.label} (${bucket.getFullCount()})`;
  };

  const activeViewAllBucket = () => {
    const mode = controller.viewAllMode();
    return mode ? controller.getBucket(mode) : undefined;
  };

  const visibleBuckets = createMemo(() => {
    const currentBins = controller.bins();
    const seenIds = new Set<string>(blockId ? [blockId] : []);
    let cumulativeIndex = 0;

    return bucketConfigs()
      .filter((config) => (currentBins[config.id] || 0) > 0)
      .map((config) => {
        const bucketLimit = currentBins[config.id] || 0;
        const bucketItems: ReturnType<typeof config.getData> = [];

        for (const item of config.getData()) {
          if (bucketItems.length >= bucketLimit) break;
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          bucketItems.push(item);
        }

        const startIndex = cumulativeIndex;
        cumulativeIndex += bucketItems.length;
        return { config, bucketItems, startIndex };
      });
  });

  const clickOutsideHandler = (e: MouseEvent) => {
    e.stopPropagation();
    props.editor?.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >(undefined);

  // Height available for scrollable content after subtracting Surface decorations.
  // Capped at 256px (16rem) to preserve desktop behavior, and floored at 0.
  const contentMaxHeight = () => {
    const h = menuAvailableHeight();
    if (h === undefined) return undefined;
    return Math.min(
      MAX_CONTENT_HEIGHT,
      Math.max(0, h - PANEL_DECORATION_HEIGHT)
    );
  };

  const floatWithElementProps = () =>
    props.anchor
      ? {
          element: () => props.anchor,
          useBlockBoundary: props.useBlockBoundary,
        }
      : undefined;

  const floatWithSelectionProps = () =>
    !props.anchor
      ? {
          selection: untrack(mountSelection),
          reactiveOnContainer: props.editor?.getRootElement(),
          useBlockBoundary: props.useBlockBoundary,
          onAvailableHeight: setMenuAvailableHeight,
          fullHeight: MAX_CONTENT_HEIGHT + PANEL_DECORATION_HEIGHT,
        }
      : undefined;

  function nativeStatus(id: string) {
    const sources: {
      id: MentionBucketId;
      loading: () => boolean;
      error: () => unknown;
    }[] = [
      { id: 'users', loading: isLoadingUsers, error: errorUsers },
      {
        id: 'documents',
        loading: docsMention.isLoading,
        error: docsMention.error,
      },
      {
        id: 'channels',
        loading: channelsMention.isLoading,
        error: channelsMention.error,
      },
      { id: 'crm', loading: crmMention.isLoading, error: crmMention.error },
      { id: 'emails', loading: isLoadingEmails, error: errorEmails },
      {
        id: 'calendarEvents',
        loading: isLoadingCalendar,
        error: errorCalendar,
      },
      { id: 'bookingLinks', loading: isLoadingBooking, error: errorBooking },
      {
        id: 'agentSessions',
        loading: () => sessionList?.isLoading() ?? false,
        error: () => sessionList?.error(),
      },
      {
        id: 'externalChats',
        loading: () => externalChatsEnabled() && externalChatsQuery.isLoading,
        error: () =>
          externalChatsEnabled() ? externalChatsQuery.error : undefined,
      },
      { id: 'routines', loading: routines.isLoading, error: routines.error },
    ];
    const statuses = sources
      .filter(
        (source) =>
          (id === 'all' || source.id === id) && sourceEnabled(source.id)
      )
      .map((source) => ({ loading: source.loading(), error: source.error() }));
    return {
      isLoading: statuses.some((status) => status.loading),
      error: statuses.some(
        (status) => status.error !== null && status.error !== undefined
      )
        ? 'Search unavailable'
        : undefined,
    };
  }

  if (props.nativePresentation) {
    presentMentionsNatively(
      props.nativePresentation,
      menuOpen,
      activeSearchTerm,
      nativeStatus,
      bucketConfigs,
      controller,
      itemAction
    );
    return null;
  }

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope} mount={props.portalMount}>
        <div
          data-holds-prompts
          class="w-96 max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content"
          classList={{ 'menu-open-animation': props.animate !== false }}
          on:touchstart={(e) => e.stopPropagation()}
          onPointerDown={(event) => {
            if (props.onPick) event.preventDefault();
          }}
          onMouseDown={(event) => {
            if (props.onPick) event.preventDefault();
          }}
          ref={(el) => {
            floatWithElement(el, floatWithElementProps);
            floatWithSelection(el, floatWithSelectionProps);
            clickOutside(el, () => clickOutsideHandler);
          }}
        >
          <Surface
            depth={2}
            hideBorder
            class="menu-surface rounded-xl pt-2 pb-1.5"
          >
            <Show
              when={controller.viewAllMode()}
              fallback={
                <Show
                  when={controller.combinedItems().length > 0}
                  fallback={
                    <div class="px-2 text-ink-extra-muted">No results</div>
                  }
                >
                  <div>
                    <Key
                      each={visibleBuckets()}
                      by={(bucket) => bucket.config.id}
                    >
                      {(bucket, idx) => (
                        <>
                          <Show when={idx() > 0}>
                            <div class="w-full mt-4 border-b border-edge-muted mb-2" />
                          </Show>
                          <ItemBin
                            label={bucket().config.label}
                            binType={bucket().config.id}
                            totalCount={bucket().config.getFullCount()}
                            showingCount={bucket().bucketItems.length}
                            isNextPage={bucket().config.hasMore}
                            onViewAll={handleViewAll}
                            isSelected={
                              controller.selectedCategory() ===
                              bucket().config.id
                            }
                          >
                            <Key each={bucket().bucketItems} by="id">
                              {(item, i) => (
                                <MentionsMenuItem
                                  item={item()}
                                  index={bucket().startIndex + i()}
                                  selected={
                                    bucket().startIndex + i() ===
                                    controller.selectedIndex()
                                  }
                                  itemAction={itemAction}
                                  setIndex={setSelectedIndexFromMouse}
                                  setOpen={setMenuOpen}
                                  offline={isOffline(item())}
                                />
                              )}
                            </Key>
                          </ItemBin>
                        </>
                      )}
                    </Key>
                  </div>
                </Show>
              }
            >
              <Show when={!isMobile()}>
                <div class="px-2 pb-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-ink-muted">
                      {viewAllCategoryLabel()}
                    </span>
                    <button
                      type="button"
                      class="text-xs font-medium text-ink-muted hover:text-ink hover:underline flex items-center gap-1"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleBackToAll();
                      }}
                    >
                      <div class="p-0.5 px-1 -my-2 bg-surface text-ink border border-edge-muted rounded-xs text-xs">
                        ←
                      </div>
                      Back to everything
                    </button>
                  </div>
                </div>
              </Show>
              <Show when={controller.combinedItems().length === 0}>
                <div class="px-2 text-ink-extra-muted">No results</div>
              </Show>
              <VirtualizedItemList
                items={controller.combinedItems()}
                selectedIndex={controller.selectedIndex()}
                itemAction={itemAction}
                offline={isOffline}
                setIndex={setSelectedIndexFromMouse}
                setOpen={setMenuOpen}
                maxHeight={contentMaxHeight()}
                hasMore={activeViewAllBucket()?.hasMore?.() ?? false}
                isLoadingMore={
                  activeViewAllBucket()?.isLoadingMore?.() ?? false
                }
                onEndReached={() => {
                  fireAndForget(
                    activeViewAllBucket()?.loadMore?.(),
                    'mentions-menu'
                  );
                }}
              />
            </Show>
          </Surface>
        </div>
      </ScopedPortal>
    </Show>
  );
}
