import type { BlockAlias, BlockName } from '@core/block';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import { EntityIcon } from '@core/component/EntityIcon';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import { UserIcon } from '@core/component/UserIcon';
import { ENABLE_CHAT_CHANNEL_ATTACHMENT } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import {
  useQuickAccess,
  type EntityItem,
  type UserItem,
  isEntityItem,
  isUserItem,
} from '@core/context/quickAccess';
import clickOutside from '@core/directive/clickOutside';
import type { ChannelWithParticipants, IUser } from '@core/user';
import {
  useDateSearch,
  type DateOption,
} from '@core/util/dateSearch/useDateSearch';
import { createFreshSearch, FreshSearchPresets } from '@core/util/freshSort';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { trackMention } from '@core/signal/mention';
import ClockIcon from '@icon/regular/clock.svg';
import EmailIcon from '@icon/regular/envelope.svg';
import UsersIcon from '@icon/regular/users.svg';
import type { ChannelEntity, EntityData, WithSearch } from '@entity';
import {
  createUnifiedSearchInfiniteQuery,
  type EmailEntity,
} from '@macro-entity';
import type { SearchArgs } from '@service-search/client';
import { debounce } from '@solid-primitives/scheduled';
import { globalSplitManager } from 'app/signal/splitLayout';
import type { LexicalEditor } from 'lexical';
import type { List } from 'lodash';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSXElement,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { floatWithElement } from '../../directive/floatWithElement';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  CLOSE_INLINE_SEARCH_COMMAND,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../../plugins';
import {
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_GROUP_MENTION_COMMAND,
} from '../../plugins/mentions';
import type { MenuOperations } from '../../shared/inlineMenu';
import {
  type DateMentionItem,
  type GroupMentionItem,
  type HandlerDependencies,
  handleUserMention,
  type MentionItem,
  type UserMentionRecord,
} from '../../utils/mentionsUtils';
import type { HistoryItem as Item } from '@queries/history/history';
import { match } from 'ts-pattern';
import { ClippedPanel } from '@core/component/ClippedPanel';

const MAX_ITEMS = 8;

function getBlockNameFromEntity(item: EntityItem): BlockName | BlockAlias {
  return match(item.bucket)
    .with('channel', () => 'channel' as const)
    .with('dm', () => 'channel' as const)
    .with('email', () => 'email' as const)
    .with('chat', () => 'chat' as const)
    .with('project', () => 'project' as const)
    .with('task', () => 'task' as const)
    .with('note', () => 'md' as const)
    .otherwise(() => {
      const entity = item.data;
      if ('fileType' in entity && typeof entity.fileType === 'string') {
        return fileTypeToBlockName(entity.fileType);
      }
      return 'unknown';
    });
}

async function handleEntityMention(
  item: EntityItem,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
    onEmailMention,
  } = dependencies;

  const entity = item.data;

  let mentionId: string | undefined;
  if (
    blockId &&
    blockName !== 'channel' &&
    blockName !== 'chat' &&
    !disableMentionTracking
  ) {
    const trackType =
      item.bucket === 'channel' || item.bucket === 'dm'
        ? 'channel'
        : 'document';
    mentionId = await trackMention(blockId, trackType, entity.id);
  }

  const blockNameForMention = getBlockNameFromEntity(item);
  const itemName = entity.name ?? (item.bucket === 'email' ? 'No Subject' : '');

  if (item.bucket === 'email') {
    onEmailMention?.(entity as unknown as EmailEntity);
  } else {
    onDocumentMention?.(entity as unknown as Item | ChannelWithParticipants);
  }

  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: entity.id,
    documentName: itemName,
    blockName: blockNameForMention,
    mentionUuid: mentionId,
    channelType:
      item.bucket === 'channel' || item.bucket === 'dm'
        ? (entity as ChannelEntity).channelType
        : undefined,
  });
}

/**
 * Handle date mention from DateOption.
 */
async function handleDateMentionFromOption(
  dateOption: DateOption,
  dependencies: HandlerDependencies
) {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
    date: dateOption.date.toISOString(),
    displayFormat: dateOption.displayText,
  });
}

/**
 * Handle group mention (e.g., @here).
 */
async function handleGroupMentionItem(
  group: { id: string; groupAlias: string },
  dependencies: HandlerDependencies
) {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_GROUP_MENTION_COMMAND, {
    groupAlias: group.groupAlias,
  });
}

/**
 * Creates a handler for MentionItem selection.
 */
function createItemHandler(dependencies: HandlerDependencies) {
  return async (item: MentionItem) => {
    if (!item) return;
    dependencies.editor.dispatchCommand(
      REMOVE_INLINE_SEARCH_COMMAND,
      undefined
    );
    switch (item.kind) {
      case 'user':
        return await handleUserMention(item.data, dependencies);
      case 'date':
        return await handleDateMentionFromOption(item.data, dependencies);
      case 'group':
        return await handleGroupMentionItem(item.data, dependencies);
      case 'entity':
        return await handleEntityMention(item, dependencies);
      case 'command':
        return;
    }
  };
}

function ItemBin(
  props: ParentProps<{
    label: string;
    binType: MentionBins;
    isNextPage?: Accessor<boolean>;
    totalCount?: number;
    showingCount?: number;
    onViewAll?: (binType: MentionBins) => void;
    isSelected?: boolean;
  }>
) {
  const showViewAllButton = () => {
    return (
      (props.binType &&
        props.totalCount &&
        props.showingCount &&
        props.totalCount > props.showingCount) ||
      props.isNextPage?.()
    );
  };
  const viewAllText = () => {
    if (
      props.totalCount &&
      props.showingCount &&
      props.totalCount > props.showingCount
    )
      return `View all (${props.totalCount})`;
    return `View all`;
  };
  return (
    <>
      <div
        class={`text-xs font-medium p-2 pt-0 flex justify-between items-center ${
          props.isSelected ? 'text-ink-muted' : 'text-ink-extra-muted'
        }`}
      >
        <span class="flex items-center gap-1">
          {props.label}
          <Show when={props.isSelected && showViewAllButton()}> →</Show>
        </span>
        <Show when={showViewAllButton()}>
          <button
            type="button"
            class="text-xs font-medium hover:text-ink hover:underline"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onViewAll?.(props.binType);
            }}
          >
            {viewAllText()}
          </button>
        </Show>
      </div>
      {props.children}
    </>
  );
}

/**
 * Calculate the correct number of items for each category.
 * The logic is each incoming bin with at least 1 item gets an outgoing bin of at least 1 item.
 * The remaining items up to MAX_ITEMS are allotted proportional to the size of the incoming bin.
 * @param bins An object with keys and incoming sizes.
 * @param targetLength An object the outgoing sizes for the same keys.
 * @returns
 */
export function computeBins<T extends string>(
  bins: Record<T, number>,
  targetLength: number
): Record<T, number> {
  const total = Object.values<number>(bins).reduce(
    (sum, count) => sum + count,
    0
  );

  if (total === 0 || targetLength === 0) {
    return Object.fromEntries(
      Object.keys(bins).map((key) => [key, 0])
    ) as Record<T, number>;
  }

  const scaled = {} as Record<T, number>;
  const offsets = {} as Record<T, number>;

  const nonEmptyBins: Array<T> = Object.entries<number>(bins)
    .filter(([_, count]) => count > 0)
    .map(([key]) => key as T);

  let allocated = 0;

  for (const key in bins) {
    scaled[key] = 0;
    offsets[key] = 0;
  }

  for (const key of nonEmptyBins) {
    if (allocated < targetLength) {
      scaled[key] = 1;
      offsets[key] = allocated;
      allocated++;
    }
  }

  const remaining = targetLength - allocated;
  if (remaining > 0 && nonEmptyBins.length > 0) {
    const nonEmptyTotal = nonEmptyBins.reduce((sum, key) => sum + bins[key], 0);
    const remainders: { key: T; remainder: number }[] = [];

    for (const key of nonEmptyBins) {
      const proportion = bins[key] / nonEmptyTotal;
      const raw = proportion * remaining;
      const floor = Math.floor(raw);
      scaled[key] += floor;
      allocated += floor;
      remainders.push({ key, remainder: raw - floor });
    }

    const leftover = targetLength - allocated;
    remainders.sort((a, b) => b.remainder - a.remainder);

    for (let i = 0; i < leftover; i++) {
      const key = remainders[i % remainders.length].key;
      scaled[key]++;
    }
  }

  return scaled;
}

/** The current bins enum */
export type MentionBins = 'items' | 'users' | 'dates' | 'emails';

/** View all mode type */
type ViewAllMode = MentionBins | null;

/** Selected category type */
type SelectedCategory = MentionBins | null;

/**
 * Get display name for a MentionItem.
 */
function getMentionItemName(item: MentionItem): string {
  switch (item.kind) {
    case 'user': {
      const { email, name } = item.data;
      if (name === email) return email;
      return `${name} | ${email}`;
    }
    case 'group':
      return `@${item.data.groupAlias}`;
    case 'date':
      return item.data.displayText;
    case 'entity':
      return item.data.name ?? (item.bucket === 'email' ? 'No Subject' : '');
    case 'command':
      return item.searchText ?? '';
  }
}

/**
 * Styled component for a single item.
 * @param props
 * @returns
 */
export function MentionsMenuItem(props: {
  item: MentionItem;
  index: number;
  selected: boolean;
  itemAction: (item: MentionItem) => void;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
}) {
  let itemRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.selected && itemRef) {
      itemRef.scrollIntoView({ block: 'nearest' });
    }
  });

  const name = () => getMentionItemName(props.item);

  const icon = () => {
    switch (props.item.kind) {
      case 'user':
        return <UserIcon id={props.item.id} size="sm" isDeleted={false} />;

      case 'group':
        return <UsersIcon class="size-4 text-ink-muted" />;

      case 'date':
        return <ClockIcon class="size-4 text-ink-muted" />;

      case 'entity':
        if (props.item.bucket === 'email') {
          return <EmailIcon class="size-4 text-ink-muted" />;
        }
        if (props.item.bucket === 'channel' || props.item.bucket === 'dm') {
          const entity = props.item.data as ChannelEntity;
          return (
            <EntityIcon
              size="xs"
              targetType={entity.channelType || 'channel'}
            />
          );
        }
        return (
          <EntityIcon
            targetType={getBlockNameFromEntity(props.item)}
            size="xs"
          />
        );

      case 'command':
        // Commands shouldn't appear in mentions menu, but handle gracefully
        return null;
    }
  };

  return (
    <div
      ref={itemRef}
      on:mouseup={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:mousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:click={(e) => {
        props.itemAction(props.item);
        props.setOpen(false);
        e.stopPropagation();
      }}
      on:mousemove={() => props.setIndex(props.index)}
      class="group flex items-center p-1.5 mx-1.5"
      classList={{ 'bg-active bracket': props.selected }}
    >
      <div class="mr-2">{icon()}</div>
      <span
        class="text-ink text-xs sm:text-sm font-medium grow overflow-hidden text-nowrap"
        style={{ 'text-overflow': 'ellipsis' }}
      >
        {name()}
      </span>
    </div>
  );
}

export function MentionsMenu(props: Parameters<typeof MentionsMenuInner>[0]) {
  return (
    <Suspense>
      <MentionsMenuInner {...props} />
    </Suspense>
  );
}

function MentionsMenuInner(props: {
  editor: LexicalEditor;
  menu: MenuOperations;
  /** pass in custom history list if necessary */
  history?: Accessor<Item[]>;
  /** pass in a custom users list if necessary */
  users?: Accessor<IUser[]>;
  /** pass in a custom channels list if necessary */
  channels?: Accessor<ChannelWithParticipants[]>;
  /** pass in a custom emails list if necessary */
  emails?: Accessor<EmailEntity[]>;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
  block?: BlockName;
  anchor?: HTMLElement | null;
  onUserMention?: (mention: UserMentionRecord) => void;
  onDocumentMention?: (item: Item | ChannelWithParticipants) => void;
  onEmailMention?: (item: EmailEntity) => void;
  disableMentionTracking?: boolean;
  /** Fetch text then past in a fold-node for plain-text mentions (useful for AI)*/
  useSnapshotForDocuments?: boolean;
}) {
  const [searchTerm, setSearchTerm] = createSignal<string>(
    props.menu.searchTerm()
  );

  // Get QuickAccess data
  const quickAccess = useQuickAccess();

  // Documents & channels from quickAccess (replaces useHistoryQuery + useChannelsContext)
  const itemsAndChannels = quickAccess.useList(
    'document',
    'note',
    'task',
    'chat',
    'project',
    'channel',
    'dm'
  );

  // Users from quickAccess (replaces useContacts)
  const usersFromQuickAccess = quickAccess.useList('person');

  // Emails from quickAccess for local data
  const emailsFromQuickAccess = quickAccess.useList('email');

  // Dates from useDateSearch (replaces getDateSuggestions)
  const dateOptionsAccessor = () => searchTerm();
  const dateOptions = useDateSearch({ query: dateOptionsAccessor });

  // Keep email unified search for paginated search results
  const args = createMemo((): SearchArgs => {
    return {
      params: {
        cursor: null,
        page_size: 10,
      },
      request: {
        match_type: 'partial',
        search_on: 'name',
        include: ['emails'],
        query: searchTerm(),
      },
    };
  });

  const emailUnifiedSearchInfiniteQuery =
    createUnifiedSearchInfiniteQuery(args);

  const foundEmailsFromSearch = createMemo((): EntityItem[] => {
    if (emailUnifiedSearchInfiniteQuery.status === 'success') {
      function isEmail(
        e: WithSearch<EntityData>
      ): e is WithSearch<EmailEntity> {
        return e.type === 'email';
      }

      return emailUnifiedSearchInfiniteQuery.data.filter(isEmail).map(
        (e): EntityItem => ({
          kind: 'entity',
          id: e.id,
          bucket: 'email',
          searchText: e.name ?? 'No Subject',
          sortTimestamp: e.updatedAt ?? 0,
          timestamps: {
            updatedAt: e.updatedAt ? new Date(e.updatedAt) : undefined,
            createdAt: e.createdAt ? new Date(e.createdAt) : undefined,
          },
          data: e,
        })
      );
    } else {
      return [];
    }
  });

  // Get open tabs from split manager
  const openTabs = createMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return [];

    const splits = splitManager.splits();
    const allItems = itemsAndChannels();
    const allEmails = emailsFromQuickAccess();

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

      const key = `${split.content.type}:${split.content.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      if (split.content.type === 'channel') {
        const channel = allItems.find(
          (item) =>
            item.id === split.content.id &&
            (item.bucket === 'channel' || item.bucket === 'dm')
        );
        if (
          ENABLE_CHAT_CHANNEL_ATTACHMENT &&
          channel &&
          isEntityItem(channel)
        ) {
          tabItems.push(channel);
        }
      } else if (split.content.type === 'email') {
        const email = allEmails.find((item) => item.id === split.content.id);
        if (email && isEntityItem(email)) {
          tabItems.push(email);
        }
      } else {
        const historyItem = allItems.find(
          (item) => item.id === split.content.id
        );
        if (historyItem && isEntityItem(historyItem)) {
          tabItems.push(historyItem);
        }
      }
    }

    return tabItems;
  });

  const historyAndChannels = createMemo(() => {
    const items = itemsAndChannels().filter(isEntityItem);
    const currentBlockId = useMaybeBlockId();

    // Deduplicate by ID and exclude current document
    const itemMap = new Map<string, EntityItem>();
    for (const item of items) {
      if (!currentBlockId || item.id !== currentBlockId) {
        itemMap.set(item.id, item);
      }
    }

    return Array.from(itemMap.values());
  });

  const [menuOpen, setMenuOpen] = [props.menu.isOpen, props.menu.setIsOpen];

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [viewAllMode, setViewAllMode] = createSignal<ViewAllMode>(null);
  const { isKeypressActive } = useIsKeyPressActive();
  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    setSelectedIndex(index);
  };

  let menuRef!: HTMLDivElement;

  const [mountSelection, setMountSelection] = createSignal<Selection | null>();

  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );

  createEffect(() => debouncedSetSearchTerm(props.menu.searchTerm()));

  // Helper function to get search text from EntityItem
  const getEntitySearchText = (item: EntityItem): string => item.searchText;

  // Helper function to get timestamps from EntityItem (returns TimestampedItem)
  const getEntityTimestamps = (item: EntityItem) => ({
    updatedAt: item.timestamps.updatedAt,
    viewedAt: item.timestamps.viewedAt,
  });

  const itemSearch = createFreshSearch<EntityItem>(
    { useViewedAt: true },
    getEntitySearchText,
    () => false,
    // (item) => item.bucket === 'channel' || item.bucket === 'dm',
    getEntityTimestamps
  );

  const filteredItems = createMemo((): EntityItem[] => {
    const allResults = itemSearch(historyAndChannels(), searchTerm()).map(
      (result) => result.item
    );

    // Separate open tabs from other items
    const openTabsSet = new Set(openTabs().map((item) => item.id));
    const tabResults: EntityItem[] = [];
    const otherResults: EntityItem[] = [];

    for (const item of allResults) {
      if (openTabsSet.has(item.id)) {
        tabResults.push(item);
      } else {
        otherResults.push(item);
      }
    }

    // Return open tabs first, then other items
    return [...tabResults, ...otherResults];
  });

  const currentUserEmail = useEmail();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  // Helper function to get search text from UserItem
  const getUserSearchText = (item: UserItem): string => item.searchText;

  // Helper function to get timestamps from UserItem (returns TimestampedItem)
  const getUserTimestamps = (item: UserItem) => ({
    lastInteraction: item.timestamps.lastInteraction,
  });

  const userSearch = createFreshSearch<UserItem>(
    FreshSearchPresets.baseUserSearch<UserItem>(
      currentUserDomain,
      (item) => item.data.email
    ),
    getUserSearchText,
    (_item) => false,
    getUserTimestamps
  );

  // Group aliases available in channel context
  const specialGroups = createMemo((): GroupMentionItem[] => {
    if (props.block !== 'channel') return [];
    if (!useMaybeBlockId()) return [];

    const term = searchTerm().toLowerCase();

    const availableGroups = [
      { alias: 'here', match: (t: string) => t === '' || 'here'.startsWith(t) },
    ];

    return availableGroups
      .filter((g) => g.match(term))
      .map(
        (g): GroupMentionItem => ({
          kind: 'group',
          id: g.alias,
          data: { id: g.alias, groupAlias: g.alias },
        })
      );
  });

  const filteredUsers = createMemo((): MentionItem[] => {
    const userItems = usersFromQuickAccess().filter(isUserItem);
    const searchedUsers = userSearch(userItems, searchTerm()).map(
      (result) => result.item
    );
    return [...specialGroups(), ...searchedUsers];
  });

  // Helper function to get search text from email EntityItem
  const getEmailSearchText = (item: EntityItem): string => item.searchText;

  // Helper function to get timestamps from email EntityItem (returns TimestampedItem)
  const getEmailTimestamps = (item: EntityItem) => ({
    updatedAt: item.timestamps.updatedAt,
    viewedAt: item.timestamps.viewedAt,
  });

  const emailSearch = createFreshSearch<EntityItem>(
    { timeWeight: 0, brevityWeight: 0.3 },
    getEmailSearchText,
    (_item) => false,
    getEmailTimestamps
  );

  const filteredEmails = createMemo((): EntityItem[] => {
    const localEmails = emailsFromQuickAccess().filter(isEntityItem);
    const mail = emailSearch(localEmails, searchTerm()).map(
      (result) => result.item
    );

    const otherMail = foundEmailsFromSearch();

    // dedup / preserve order
    const ids = new Set(mail.map((e) => e.id));
    return [...mail, ...otherMail.filter((e) => !ids.has(e.id))];
  });

  // Convert DateOptions to DateMentionItems
  const dateSuggestions = createMemo((): DateMentionItem[] => {
    return dateOptions().map(
      (option): DateMentionItem => ({
        kind: 'date',
        id: `date-${option.id}`,
        data: option,
      })
    );
  });

  // The raw bins store the counts for all matching items
  const rawBins = createMemo<Record<MentionBins, number>>(() => ({
    users: filteredUsers().length,
    items: filteredItems().length,
    dates: dateSuggestions().length,
    emails: filteredEmails().length,
  }));

  // The bins is the limited and rounded count for each bucket
  const bins = createMemo(() => computeBins(rawBins(), MAX_ITEMS));

  const combinedItems = createMemo<MentionItem[]>(() => {
    const currentViewAllMode = viewAllMode();

    if (currentViewAllMode) {
      // in view all mode, show all items for that category only
      switch (currentViewAllMode) {
        case 'users':
          return filteredUsers();
        case 'items':
          return filteredItems();
        case 'dates':
          return dateSuggestions();
        case 'emails':
          return filteredEmails();
        default:
          return [];
      }
    }

    // normal mode: show limited items from all categories
    return [
      ...filteredUsers().slice(0, bins().users),
      ...filteredItems().slice(0, bins().items),
      ...dateSuggestions().slice(0, bins().dates),
      ...filteredEmails().slice(0, bins().emails),
    ];
  });

  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | 'double' | null
  >('start');
  createEffect(() => {
    if (!menuOpen()) {
      setEscapeSpaceState('start');
      setViewAllMode(null);
    }
  });

  const selectedCategory = createMemo<SelectedCategory>(() => {
    if (viewAllMode()) return null; // no category selection in view all mode

    const index = selectedIndex();
    const { users, items, dates, emails } = bins();

    let currentIndex = 0;

    if (users > 0) {
      if (index < currentIndex + users) {
        return 'users';
      }
      currentIndex += users;
    }

    if (items > 0) {
      if (index < currentIndex + items) {
        return 'items';
      }
      currentIndex += items;
    }

    if (dates > 0) {
      if (index < currentIndex + dates) {
        return 'dates';
      }
      currentIndex += dates;
    }

    if (emails > 0) {
      if (index < currentIndex + emails) {
        return 'emails';
      }
    }

    return null;
  });

  const itemAction = createItemHandler({
    editor: props.editor,
    blockName: useMaybeBlockName(),
    blockId: useMaybeBlockId(),
    onUserMention: props.onUserMention,
    onDocumentMention: props.onDocumentMention,
    onEmailMention: props.onEmailMention,
    disableMentionTracking: props.disableMentionTracking,
    useSnapshotNode: props.useSnapshotForDocuments,
  });

  createEffect(() => {
    if (props.anchor) return;
    if (menuOpen()) {
      setMountSelection(document.getSelection());
      setSelectedIndex(0);
    } else {
      setMountSelection(null);
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!menuOpen()) return;

    const items = combinedItems();
    const selectedItem = items[selectedIndex()];

    const handleArrowDown = () => {
      setSelectedIndex((p) => {
        if (p >= combinedItems.length) {
          if (
            viewAllMode() === 'emails' &&
            emailUnifiedSearchInfiniteQuery.isFetching
          ) {
            return items.length - 1;
          } else {
            return (p + 1) % items.length;
          }
        } else {
          return p + 1;
        }
      });
    };

    switch (e.key) {
      case ' ':
        switch (escapeSpaceState()) {
          case 'double':
          case 'start':
            props.editor.dispatchCommand(
              CLOSE_INLINE_SEARCH_COMMAND,
              undefined
            );
            setMenuOpen(false);
            break;
          case 'single':
            setEscapeSpaceState('double');
            break;
          case null:
            setEscapeSpaceState('single');
            break;
        }
        break;

      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (viewAllMode()) {
          handleBackToAll();
        } else {
          props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
          setMenuOpen(false);
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        handleArrowDown();
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) =>
          prev - 1 < 0 ? items.length - 1 : prev - 1
        );
        break;

      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        if (viewAllMode()) {
          handleBackToAll();
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        if (!viewAllMode()) {
          const currentCategory = selectedCategory();
          if (currentCategory) {
            const currentBins = bins();
            const currentRawBins = rawBins();
            const abbreviatedCount = currentBins[currentCategory];
            const fullCount = currentRawBins[currentCategory];
            if (
              abbreviatedCount < fullCount ||
              (emailUnifiedSearchInfiniteQuery.hasNextPage &&
                currentCategory === 'emails')
            ) {
              handleViewAll(currentCategory);
            }
          }
        }
        break;

      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        } else {
          setSelectedIndex((prev) => (prev + 1) % items.length);
        }
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (selectedItem) {
          itemAction(selectedItem);
        } else {
          props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
        }
        setSearchTerm('');
        setMenuOpen(false);
        break;

      default:
        setEscapeSpaceState(null);
        break;
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    });
  });

  const focusOut = () => {
    props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  onMount(() => {
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      document.removeEventListener('focusout', focusOut);
    });
  });

  createEffect(() => {
    if (
      selectedIndex() >= combinedItems().length - 5 &&
      viewAllMode() === 'emails' &&
      emailUnifiedSearchInfiniteQuery.hasNextPage &&
      !emailUnifiedSearchInfiniteQuery.isFetching
    ) {
      emailUnifiedSearchInfiniteQuery.fetchNextPage();
    }
    if (selectedIndex() >= combinedItems().length) {
      setSelectedIndex(combinedItems().length - 1);
    }
  });

  const handleViewAll = (binType: MentionBins) => {
    setViewAllMode(binType);
    setSelectedIndex(0);
  };

  const handleBackToAll = () => {
    setViewAllMode(null);
    setSelectedIndex(0);
  };

  const hasOnlyOneCategory = createMemo(() => {
    const currentRawBins = rawBins();
    const categoriesWithMatches = Object.values(currentRawBins).filter(
      (count) => count > 0
    );
    return categoriesWithMatches.length === 1;
  });

  const inner = createMemo(() => {
    const currentViewAllMode = viewAllMode();

    // ---- SINGLE BUCKET MODE -------------------------------------------------
    if (currentViewAllMode) {
      const allItems = combinedItems();
      const totalLength = () => allItems.length;

      const renderViewAllOptions = createMemo(() => {
        const categoryLabel = {
          users: 'People',
          items: 'Documents & Channels',
          dates: 'Dates',
          emails: 'Emails',
        }[currentViewAllMode];

        return (
          <>
            <div class="px-2 pb-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-ink-muted">
                  {categoryLabel}
                </span>
                <button
                  type="button"
                  class="text-xs font-medium text-ink-muted hover:text-ink hover:underline"
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
                  ←{' '}
                  {hasOnlyOneCategory()
                    ? 'Back to summary'
                    : 'Back to everything'}
                </button>
              </div>
            </div>
            <div class="max-h-64 overflow-y-auto scrollbar-hidden">
              <For each={allItems}>
                {(item, i) => (
                  <MentionsMenuItem
                    item={item}
                    index={i()}
                    selected={i() === selectedIndex()}
                    itemAction={itemAction}
                    setIndex={setSelectedIndexFromMouse}
                    setOpen={setMenuOpen}
                  />
                )}
              </For>
            </div>
          </>
        );
      });

      return (
        <Show
          when={totalLength() > 0}
          fallback={<div class="px-2 text-ink-extra-muted">No results</div>}
        >
          {renderViewAllOptions()}
        </Show>
      );
    }

    // ------ NORMAL MODE ------------------------------------------------------
    const users = filteredUsers().slice(0, bins().users);
    const docs = filteredItems().slice(0, bins().items);
    const dates = dateSuggestions().slice(0, bins().dates);
    const emailList = filteredEmails().slice(0, bins().emails);
    const totalLength = () =>
      users.length + docs.length + dates.length + emailList.length;

    const RenderOptions = () => {
      const options = [];
      if (users.length > 0) {
        options.push(
          <ItemBin
            label="People"
            binType="users"
            totalCount={filteredUsers().length}
            showingCount={users.length}
            onViewAll={handleViewAll}
            isSelected={selectedCategory() === 'users'}
          >
            <For each={users}>
              {(item, i) => (
                <MentionsMenuItem
                  item={item}
                  index={i()}
                  selected={i() === selectedIndex()}
                  itemAction={itemAction}
                  setIndex={setSelectedIndexFromMouse}
                  setOpen={setMenuOpen}
                />
              )}
            </For>
          </ItemBin>
        );
      }

      if (docs.length > 0) {
        options.push(
          <ItemBin
            label="Documents & Channels"
            binType="items"
            totalCount={filteredItems().length}
            showingCount={docs.length}
            onViewAll={handleViewAll}
            isSelected={selectedCategory() === 'items'}
          >
            <For each={docs}>
              {(item, i) => (
                <MentionsMenuItem
                  item={item}
                  index={users.length + i()}
                  selected={users.length + i() === selectedIndex()}
                  itemAction={itemAction}
                  setIndex={setSelectedIndexFromMouse}
                  setOpen={setMenuOpen}
                />
              )}
            </For>
          </ItemBin>
        );
      }

      if (dates.length > 0) {
        options.push(
          <ItemBin
            label="Dates"
            binType="dates"
            totalCount={dateSuggestions().length}
            showingCount={dates.length}
            onViewAll={handleViewAll}
            isSelected={selectedCategory() === 'dates'}
          >
            <For each={dates}>
              {(item, i) => (
                <MentionsMenuItem
                  item={item}
                  index={users.length + docs.length + i()}
                  selected={
                    users.length + docs.length + i() === selectedIndex()
                  }
                  itemAction={itemAction}
                  setIndex={setSelectedIndexFromMouse}
                  setOpen={setMenuOpen}
                />
              )}
            </For>
          </ItemBin>
        );
      }

      if (emailList.length > 0) {
        options.push(
          <ItemBin
            label="Emails"
            binType="emails"
            isNextPage={() => emailUnifiedSearchInfiniteQuery.hasNextPage}
            totalCount={filteredEmails().length}
            showingCount={emailList.length}
            onViewAll={handleViewAll}
            isSelected={selectedCategory() === 'emails'}
          >
            <For each={emailList}>
              {(item, i) => (
                <MentionsMenuItem
                  item={item}
                  index={i()}
                  selected={
                    users.length + docs.length + dates.length + i() ===
                    selectedIndex()
                  }
                  itemAction={itemAction}
                  setIndex={setSelectedIndexFromMouse}
                  setOpen={setMenuOpen}
                />
              )}
            </For>
          </ItemBin>
        );
      }

      return options.map(
        (option: JSXElement, index: number, array: List<JSXElement>) => (
          <>
            {option}
            <Show when={index < array.length - 1}>
              <div class="w-full mt-4 border-b-1 border-edge mb-2" />
            </Show>
          </>
        )
      );
    };

    return (
      <Show
        when={totalLength() > 0}
        fallback={<div class="px-2 text-ink-extra-muted">No results</div>}
      >
        <div>
          <Dynamic component={RenderOptions} />
        </div>
      </Show>
    );
  });

  const clickOutsideHandler = (e: MouseEvent) => {
    e.stopPropagation();
    props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
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
          reactiveOnContainer: props.editor.getRootElement(),
          useBlockBoundary: props.useBlockBoundary,
        }
      : undefined;

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="w-96 cursor-default select-none z-modal-content"
          ref={(el) => {
            menuRef = el;
            floatWithElement(el, floatWithElementProps);
            floatWithSelection(el, floatWithSelectionProps);
            clickOutside(el, () => clickOutsideHandler);
          }}
        >
          <ClippedPanel active tl class="py-2">
            {inner()}
          </ClippedPanel>
        </div>
      </ScopedPortal>
    </Show>
  );
}
