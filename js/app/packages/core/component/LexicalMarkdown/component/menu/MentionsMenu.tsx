import {
  type BlockName,
  useMaybeBlockId,
  useMaybeBlockName,
} from '@core/block';
import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import { BozzyBracketInnerSibling } from '@core/component/BozzyBracket';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import { EntityIcon } from '@core/component/EntityIcon';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { ENABLE_CHAT_CHANNEL_ATTACHMENT } from '@core/constant/featureFlags';
import clickOutside from '@core/directive/clickOutside';
import { trackMention } from '@core/signal/mention';
import {
  type ChannelWithParticipants,
  type EmailContact,
  type IUser,
  isCompanyEmailContact,
  useContacts,
  useEmailContacts,
  useOrganizationUsers,
} from '@core/user';
import { mergeByKey } from '@core/util/compareUtils';
import { getDateSuggestions, type ParsedDate } from '@core/util/dateParser';
import { createFreshSearch } from '@core/util/freshSort';
import BuildingIcon from '@icon/regular/buildings.svg';
import ClockIcon from '@icon/regular/clock.svg';
import EmailIcon from '@icon/regular/envelope.svg';
import UserIconSolid from '@icon/regular/user.svg';
import { type EmailEntity, useEmails } from '@macro-entity';
import type { DocumentMentionMetadata } from '@service-notification/client';
import { storageServiceClient } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { useHistory } from '@service-storage/history';
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
  untrack,
} from 'solid-js';
import { v7 } from 'uuid';
import { floatWithElement } from '../../directive/floatWithElement';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  CLOSE_INLINE_SEARCH_COMMAND,
  INSERT_CONTACT_MENTION_COMMAND,
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_USER_MENTION_COMMAND,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../../plugins';
import type { MenuOperations } from '../../shared/inlineMenu';

false && clickOutside;
false && floatWithSelection;
false && floatWithElement;

/** The total number of max items in the menu. */
const MAX_ITEMS = 8;

/** Whether to filter sidebar non-persistent-chats */
const ONLY_REAL_CHATS = false;

export type UserMentionRecord = {
  documentId: string;
  mentions: string[];
  metadata: DocumentMentionMetadata;
};

type DateItem = ParsedDate & {
  id: string;
};

type EntityMap = {
  item: Item;
  user: IUser;
  channel: ChannelWithParticipants;
  emailContact: EmailContact;
  date: DateItem;
  email: EmailEntity;
};

type Entity<T extends keyof EntityMap> = {
  kind: T;
  id: EntityMap[T]['id'];
  data: EntityMap[T];
};

type PickEntity<K extends keyof EntityMap> = {
  [P in K]: Entity<P>;
}[K];

type CombinedEntity<K extends keyof EntityMap = keyof EntityMap> =
  PickEntity<K>;

// mapper fn that converts  entity data to its entity type
type EntityMapper<K extends keyof EntityMap> = (
  data: EntityMap[K]
) => PickEntity<K>;

function entityMapper<K extends keyof EntityMap>(kind: K): EntityMapper<K> {
  return (data: EntityMap[K]) => ({ kind, data, id: data.id });
}

const getUserName = (item: IUser): string => {
  const { email, name } = item;
  if (name === email) return email;
  return `${name} | ${email}`;
};

const getUserSearchText = (item: IUser): string => {
  const { email, name } = item;
  // Note: we return the email twice to make users with a display name
  // able to rank above users without a display name.
  if (name === email) return `${email} | ${email}`;
  return `${name} | ${email}`;
};

const getContactName = (item: EmailContact): string => {
  const { name, type } = item;
  switch (type) {
    case 'company':
      return item.name;
    case 'person':
      if (name === item.email) return item.email;
      return `${name} | ${item.email}`;
  }
};

const getCombinedEntityBlockName = (
  item: CombinedEntity<'item' | 'channel' | 'email'>,
  icon?: boolean
): BlockName => {
  switch (item.kind) {
    case 'item':
      if (item.data.type === 'document')
        return fileTypeToBlockName(item.data.fileType, icon);
      if (item.data.type === 'chat') return 'chat';
      if (item.data.type === 'project') return 'project';
      return 'unknown';
    case 'email':
      return 'email';
    case 'channel':
      return 'channel';
  }
};

const getItemName = (item: CombinedEntity): string => {
  switch (item.kind) {
    case 'item':
      return item.data.name;
    case 'user':
      return getUserName(item.data);
    case 'channel':
      return item.data.name ?? '';
    case 'emailContact':
      return getContactName(item.data);
    case 'email':
      return item.data.name ?? 'No Subject';
    case 'date':
      return item.data.displayFormat;
  }
};

const getItemSearchText = (item: CombinedEntity): string => {
  switch (item.kind) {
    case 'item':
      return item.data.name;
    case 'user':
      return getUserSearchText(item.data);
    case 'channel':
      return item.data.name ?? '';
    case 'emailContact':
      return getContactName(item.data);
    case 'date':
      return item.data.displayFormat;
    case 'email':
      return item.data.name ?? 'No Subject';
  }
};

/**
 * All incoming items will be run through this filter function. PLEASE use this function
 * to ignore certain items before they make it to search.
 * @param item
 * @returns
 */
function allItemFilter(item: CombinedEntity): boolean {
  if (
    ONLY_REAL_CHATS &&
    item.kind === 'item' &&
    item.data.type === 'chat' &&
    item.data.isPersistent
  ) {
    return false;
  }
  return true;
}

/**
 * These are the stateful utils needed to handle an item of a given type. I have opted
 * to implement the handlers as smaller helpers rather than 1 giant function. So these
 * dependencies have to be injected via the component.
 */
type HandlerDependencies = {
  editor: LexicalEditor;
  blockName?: BlockName;
  blockId?: string;
  onUserMention?: (record: UserMentionRecord) => void;
  onDocumentMention?: (item: Item | ChannelWithParticipants) => void;
  disableMentionTracking?: boolean;
  onEmailMention?: (item: EmailEntity) => void;
};

/**
 * Handles user mentions by lexical inserting and potentially up-serting to the notification service.
 * @param user The user to mention.
 * @param dependencies The dependencies required to handle the user mention.
 */
async function handleUserMention(
  user: IUser,
  dependencies: HandlerDependencies
) {
  const { editor, blockName, blockId, onUserMention, disableMentionTracking } =
    dependencies;
  let mentionId: string | undefined;

  if (blockName !== 'channel') {
    if (blockId) {
      const record: UserMentionRecord = {
        documentId: blockId,
        mentions: [user.id],
        metadata: {
          mention_id: v7(),
        },
      };
      if (onUserMention) {
        onUserMention(record);
      } else {
        storageServiceClient.upsertUserMentions(record);
      }
      if (!disableMentionTracking) {
        mentionId = await trackMention(blockId, 'user', user.id);
      }
    }
  }

  editor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
    userId: user.id,
    email: user.email,
    mentionUuid: mentionId,
  });
}

/**
 * Inserts a contact mention.
 * @param contact
 * @param dependencies
 */
async function handleContactMention(
  contact: EmailContact,
  dependencies: HandlerDependencies
) {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_CONTACT_MENTION_COMMAND, {
    contactId: contact.id,
    name: contact.name,
    emailOrDomain: isCompanyEmailContact(contact)
      ? contact.domain
      : contact.email,
    isCompany: isCompanyEmailContact(contact),
  });
}

/**
 * Inserts a date mention.
 * @param date
 * @param dependencies
 */
async function handleDateMention(
  date: DateItem,
  dependencies: HandlerDependencies
) {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
    date: date.date.toISOString(),
    displayFormat: date.displayFormat,
  });
}

async function handleEmailMention(
  email: EmailEntity,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onEmailMention,
    disableMentionTracking,
  } = dependencies;
  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'document', email.id);
  }
  const itemName = email.name ?? 'No Subject';

  onEmailMention?.(email);

  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: email.id,
    documentName: itemName,
    blockName: 'email',
    mentionUuid: mentionId,
  });
}

/**
 * Insert a document mentions and track it.
 * @param item
 * @param dependencies
 */
async function handleBasicMention(
  item: Item,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
  } = dependencies;
  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'document', item.id);
  }
  const itemEntity = entityMapper('item')(item);
  const itemBlock = getCombinedEntityBlockName(itemEntity);
  const itemName = getItemName(itemEntity);

  onDocumentMention?.(item);

  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: item.id,
    documentName: itemName,
    blockName: itemBlock,
    mentionUuid: mentionId,
  });
}

/**
 * Insert a channel mention and track it.
 * @param channel
 * @param dependencies
 */
async function handleChannelMention(
  channel: ChannelWithParticipants,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
  } = dependencies;
  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'channel', channel.id);
  }
  const channelEntity = entityMapper('channel')(channel);
  const itemBlock = getCombinedEntityBlockName(channelEntity);
  const itemName = getItemName(channelEntity);

  onDocumentMention?.(channel);

  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: channel.id,
    documentName: itemName,
    blockName: itemBlock,
    mentionUuid: mentionId,
    channelType: channel.channel_type,
  });
}

/**
 * Create the universal item handler.
 * @param dependencies
 * @returns
 */
function createItemHandler(dependencies: HandlerDependencies) {
  return async (item: CombinedEntity) => {
    if (!item) return;
    dependencies.editor.dispatchCommand(
      REMOVE_INLINE_SEARCH_COMMAND,
      undefined
    );
    switch (item.kind) {
      case 'user':
        return await handleUserMention(item.data, dependencies);
      case 'emailContact':
        return await handleContactMention(item.data, dependencies);
      case 'date':
        return await handleDateMention(item.data, dependencies);
      case 'item':
        return await handleBasicMention(item.data, dependencies);
      case 'channel':
        return await handleChannelMention(item.data, dependencies);
      case 'email':
        return await handleEmailMention(item.data, dependencies);
    }
  };
}

/**
 * Styled container for single category.
 */
function ItemBin(
  props: ParentProps<{
    label: string;
    binType: MentionBins;
    totalCount?: number;
    showingCount?: number;
    onViewAll?: (binType: MentionBins) => void;
    isSelected?: boolean;
  }>
) {
  const showViewAllButton = () =>
    props.binType &&
    props.totalCount &&
    props.showingCount &&
    props.totalCount > props.showingCount;

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
            View all ({props.totalCount})
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
export type MentionBins = 'items' | 'users' | 'contacts' | 'dates' | 'emails';

/** View all mode type */
type ViewAllMode = MentionBins | null;

/** Selected category type */
type SelectedCategory = MentionBins | null;

/**
 * Styled component for a single item.
 * @param props
 * @returns
 */
export function MentionsMenuItem(props: {
  item: CombinedEntity;
  index: number;
  selected: boolean;
  itemAction: (item: CombinedEntity) => void;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
}) {
  let itemRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.selected && itemRef) {
      itemRef.scrollIntoView({ block: 'nearest' });
    }
  });

  const name = () => getItemName(props.item);

  const icon = () => {
    switch (props.item.kind) {
      case 'user':
        return <UserIcon id={props.item.id} size="sm" isDeleted={false} />;

      case 'emailContact':
        return isCompanyEmailContact(props.item.data) ? (
          <BuildingIcon class="size-4 text-ink-muted" />
        ) : (
          <UserIconSolid class="size-4 text-ink-muted" />
        );

      case 'date':
        return <ClockIcon class="size-4 text-ink-muted" />;

      case 'channel':
        return (
          <EntityIcon
            size="xs"
            targetType={
              props.item.data.channel_type === 'direct_message'
                ? 'directMessage'
                : props.item.data.channel_type === 'organization'
                  ? 'company'
                  : 'channel'
            }
          />
        );

      case 'item':
        return (
          <EntityIcon
            targetType={getCombinedEntityBlockName(props.item, true)}
            size="xs"
          />
        );
      case 'email':
        return <EmailIcon class="size-4 text-ink-muted" />;
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
      on:mouseover={() => props.setIndex(props.index)}
      class="group flex items-center p-1.5 mx-1.5"
      classList={{ 'bg-active bracket': props.selected }}
    >
      <div class="mr-2">{icon()}</div>
      <span
        class="text-ink text-xs sm:text-sm font-medium grow overflow-hidden text-nowrap"
        classList={{
          capitalize:
            props.item.kind === 'emailContact' &&
            isCompanyEmailContact(props.item.data),
        }}
        style={{ 'text-overflow': 'ellipsis' }}
      >
        {name()}
      </span>
    </div>
  );
}

export function MentionsMenu(props: {
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
}) {
  const historyAccessor = props.history ?? useHistory();
  const history = createMemo(() => {
    return historyAccessor().map(entityMapper('item'));
  });

  const emailContactsAccessor = useEmailContacts();
  const emailContacts = createMemo(() => {
    return emailContactsAccessor().map(entityMapper('emailContact'));
  });

  let emails: Accessor<Entity<'email'>[]>;
  if (props.emails) {
    emails = createMemo(
      () =>
        props.emails?.().map(entityMapper('email')).filter(allItemFilter) ?? []
    );
  } else {
    const emailsFromSource = useEmails();
    emails = createMemo(
      () =>
        emailsFromSource().map(entityMapper('email')).filter(allItemFilter) ??
        []
    );
  }

  let users: Accessor<Entity<'user'>[]>;
  if (props.users) {
    users = createMemo(
      () =>
        props.users?.().map(entityMapper('user')).filter(allItemFilter) ?? []
    );
  } else {
    const orgUsers = useOrganizationUsers();
    const contacts = useContacts();
    users = createMemo(() =>
      mergeByKey('id', contacts(), orgUsers())
        .map(entityMapper('user'))
        .filter(allItemFilter)
    );
  }

  let channels: Accessor<Entity<'channel'>[]>;
  if (props.channels) {
    channels = createMemo(
      () =>
        props.channels?.().map(entityMapper('channel')).filter(allItemFilter) ??
        []
    );
  } else {
    const { channels: userChannels } = useChannelsContext();
    channels = createMemo(() => {
      if (!ENABLE_CHAT_CHANNEL_ATTACHMENT && props.block === 'chat') {
        return [];
      }
      return userChannels().map(entityMapper('channel')).filter(allItemFilter);
    });
  }

  // Get open tabs from split manager
  const openTabs = createMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return [];

    const splits = splitManager.splits();
    const historyItems = history();
    const channelList = channels();
    const emailList = emails();

    const tabItems: CombinedEntity<'item' | 'channel' | 'email'>[] = [];

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
        // Find the channel in our channels list
        const channel = channelList.find((ch) => ch.id === split.content.id);
        if (ENABLE_CHAT_CHANNEL_ATTACHMENT && channel) {
          tabItems.push(channel);
        }
      } else if (split.content.type === 'email') {
        const e = emailList.find((e) => e.id === split.content.id);
        if (e) tabItems.push(e);
      } else {
        // Find the document in history
        const historyItem = historyItems.find(
          (item) => item.id === split.content.id
        );
        if (historyItem) {
          tabItems.push(historyItem);
        }
      }
    }

    return tabItems.filter(allItemFilter);
  });

  const historyAndChannels = createMemo(() => {
    const historyItems = history().filter(allItemFilter);
    const channelItems = channels();
    const currentBlockId = useMaybeBlockId();

    // Create a map to deduplicate by ID
    const itemMap = new Map<string, CombinedEntity<'item' | 'channel'>>();

    // Add history items first (excluding current document)
    for (const item of historyItems) {
      if (!currentBlockId || item.id !== currentBlockId) {
        itemMap.set(item.id, item);
      }
    }

    // Add channel items (excluding current channel)
    for (const item of channelItems) {
      if (!currentBlockId || item.id !== currentBlockId) {
        itemMap.set(item.id, item);
      }
    }

    // Open tabs are already included in history/channels, so we don't need to add them separately
    // The prioritization happens in filteredItems instead

    return Array.from(itemMap.values());
  });

  const [menuOpen, setMenuOpen] = [props.menu.isOpen, props.menu.setIsOpen];

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [viewAllMode, setViewAllMode] = createSignal<ViewAllMode>(null);

  let menuRef!: HTMLDivElement;

  const [mountSelection, setMountSelection] = createSignal<Selection | null>();

  const [searchTerm, setSearchTerm] = createSignal(props.menu.searchTerm());

  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );

  createEffect(() => {
    debouncedSetSearchTerm(props.menu.searchTerm());
  });

  const itemSearch = createFreshSearch<CombinedEntity<'item' | 'channel'>>(
    {},
    getItemSearchText
  );
  const filteredItems = createMemo(() => {
    const allResults = itemSearch(historyAndChannels(), searchTerm()).map(
      (result) => {
        return result.item;
      }
    );

    // Separate open tabs from other items
    const openTabsSet = new Set(openTabs().map((item) => item.id));
    const tabResults: CombinedEntity<'item' | 'channel' | 'email'>[] = [];
    const otherResults: CombinedEntity<'item' | 'channel' | 'email'>[] = [];

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

  const userSearch = createFreshSearch<Entity<'user'>>(
    { timeWeight: 0, brevityWeight: 0.3 },
    getItemSearchText
  );
  const filteredUsers = createMemo(() => {
    return userSearch(users(), searchTerm()).map((result) => {
      return result.item;
    });
  });

  const contactSearch = createFreshSearch<Entity<'emailContact'>>(
    { timeWeight: 0.1, brevityWeight: 0.3 },
    getItemSearchText
  );

  const filteredContacts = createMemo(() => {
    return contactSearch(emailContacts(), searchTerm()).map((result) => {
      return result.item;
    });
  });

  const emailSearch = createFreshSearch<Entity<'email'>>(
    { timeWeight: 0, brevityWeight: 0.3 },
    getItemSearchText
  );

  const filteredEmails = createMemo(() => {
    return emailSearch(emails(), searchTerm()).map((result) => result.item);
  });

  const dateSuggestions = createMemo(() => {
    const suggestions = getDateSuggestions(searchTerm());
    return suggestions
      .map((suggestion) => ({
        ...suggestion,
        id: `date-${suggestion.date.toISOString()}`,
      }))
      .map(entityMapper('date'));
  });

  // The raw bins store the counts for all matching items
  const rawBins = createMemo<Record<MentionBins, number>>(() => ({
    users: filteredUsers().length,
    items: filteredItems().length,
    contacts: filteredContacts().length,
    dates: dateSuggestions().length,
    emails: filteredEmails().length,
  }));

  // The bins is the limited and rounded count for each bucket
  const bins = createMemo(() => computeBins(rawBins(), MAX_ITEMS));

  const combinedItems = createMemo<CombinedEntity[]>(() => {
    const currentViewAllMode = viewAllMode();

    if (currentViewAllMode) {
      // in view all mode, show all items for that category only
      switch (currentViewAllMode) {
        case 'users':
          return filteredUsers();
        case 'items':
          return filteredItems();
        case 'contacts':
          return filteredContacts();
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
      ...filteredContacts().slice(0, bins().contacts),
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
    const { users, items, contacts, dates, emails } = bins();

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

    if (contacts > 0) {
      if (index < currentIndex + contacts) {
        return 'contacts';
      }
      currentIndex += contacts;
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
        setSelectedIndex((prev) => (prev + 1) % items.length);
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
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

            // allow view all if there are more items to show
            if (fullCount > abbreviatedCount) {
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
          contacts: 'Contacts & Companies',
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
                  class="text-xs font-medium text-ink-muted hover:text-ink hover:underline cursor-pointer"
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
            <div class="max-h-64 overflow-y-auto">
              <For each={allItems}>
                {(item, i) => (
                  <MentionsMenuItem
                    item={item}
                    index={i()}
                    selected={i() === selectedIndex()}
                    itemAction={itemAction}
                    setIndex={setSelectedIndex}
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
    const contactsList = filteredContacts().slice(0, bins().contacts);
    const dates = dateSuggestions().slice(0, bins().dates);
    const emailList = filteredEmails().slice(0, bins().emails);
    const totalLength = () =>
      users.length + docs.length + contactsList.length + dates.length;

    const renderOptions = createMemo(() => {
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
                  setIndex={setSelectedIndex}
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
                  setIndex={setSelectedIndex}
                  setOpen={setMenuOpen}
                />
              )}
            </For>
          </ItemBin>
        );
      }

      if (contactsList.length > 0) {
        options.push(
          <ItemBin
            label="Contacts & Companies"
            binType="contacts"
            totalCount={filteredContacts().length}
            showingCount={contactsList.length}
            onViewAll={handleViewAll}
            isSelected={selectedCategory() === 'contacts'}
          >
            <For each={contactsList}>
              {(item, i) => (
                <MentionsMenuItem
                  item={item}
                  index={users.length + docs.length + i()}
                  selected={
                    users.length + docs.length + i() === selectedIndex()
                  }
                  itemAction={itemAction}
                  setIndex={setSelectedIndex}
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
                  index={users.length + docs.length + contactsList.length + i()}
                  selected={
                    users.length + docs.length + contactsList.length + i() ===
                    selectedIndex()
                  }
                  itemAction={itemAction}
                  setIndex={setSelectedIndex}
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
                    users.length +
                      docs.length +
                      contactsList.length +
                      dates.length +
                      i() ===
                    selectedIndex()
                  }
                  itemAction={itemAction}
                  setIndex={setSelectedIndex}
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
    });

    return (
      <Show
        when={totalLength() > 0}
        fallback={<div class="px-2 text-ink-extra-muted">No results</div>}
      >
        <div>{renderOptions()}</div>
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
          use:floatWithElement={floatWithElementProps()}
          use:floatWithSelection={floatWithSelectionProps()}
          use:clickOutside={clickOutsideHandler}
          ref={menuRef}
        >
          <div class="relative overflow-hidden ring-1 ring-edge bg-menu shadow-xl py-2">
            {inner()}
          </div>
          <BozzyBracketInnerSibling animOnOpen={true} />
        </div>
      </ScopedPortal>
    </Show>
  );
}
