import { useBlockId } from '@core/block';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { ChannelWithParticipants, IUser } from '@core/user';
import { idToEmail, useContacts, useDisplayName } from '@core/user';
import { createFreshSearch } from '@core/util/freshSort';
import CheckIcon from '@icon/bold/check-bold.svg';
import CompanyIcon from '@icon/duotone/building-duotone.svg';
import ChannelBuildingIcon from '@icon/duotone/building-office-duotone.svg';
import ThreadIcon from '@icon/duotone/envelope-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ChannelIcon from '@icon/duotone/hash-duotone.svg';
import User from '@icon/duotone/user-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import {
  createEmailsInfiniteQuery,
  createUnifiedSearchInfiniteQuery,
  type EmailEntity,
} from '@macro-entity';
import { useUserId } from '@service-gql/client';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Item } from '@service-storage/generated/schemas/item';
import { useHistory } from '@service-storage/history';
import { debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import { usePropertiesContext } from '../../../context/PropertiesContext';
import { PROPERTY_STYLES } from '../../../styles/styles';
import type { Property } from '../../../types';
import { useSearchInputFocus } from '../../../utils';

type EntityInputProps = {
  property: Property;
  selectedOptions: () => Set<string>;
  setSelectedOptions: (
    options: Set<string>,
    entityInfo?: { id: string; entity_type: string }[]
  ) => void;
  setHasChanges: (hasChanges: boolean) => void;
};

const INPUT_CLASSES = PROPERTY_STYLES.input.search;
const ENTITY_ITEM_BASE =
  'flex items-center justify-between gap-2 py-1.5 px-2 border border-edge cursor-pointer min-w-0';
const CHECKBOX_BASE = 'w-4 h-4 border flex items-center justify-center';
const ICON_CLASSES = 'size-4 text-ink-muted';

function getEntityTypePluralLabel(
  entityType: EntityType | null | undefined
): string {
  if (!entityType) return 'entities';
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
    case 'THREAD':
      return 'emails';
    case 'TASK':
      return 'tasks';
    default:
      return 'entities';
  }
}

type CombinedEntity =
  | { kind: 'item'; id: string; data: Item }
  | { kind: 'user'; id: string; data: IUser }
  | { kind: 'channel'; id: string; data: ChannelWithParticipants }
  | { kind: 'company'; id: string; data: null }
  | { kind: 'thread'; id: string; data: EmailEntity };

function entityMapper(kind: 'item' | 'user' | 'channel') {
  return (data: Item | IUser | ChannelWithParticipants): CombinedEntity => {
    return { kind, data, id: (data as { id: string }).id } as CombinedEntity;
  };
}

function threadMapper(email: EmailEntity): CombinedEntity {
  return { kind: 'thread', id: email.id, data: email };
}

function getEntityName(entity: CombinedEntity): string {
  switch (entity.kind) {
    case 'item':
      return entity.data.name;
    case 'user': {
      const { name, email } = entity.data;
      if (name === email) return email;
      return `${name} | ${email}`;
    }
    case 'channel':
      return entity.data.name ?? '';
    case 'company':
      return entity.id;
    case 'thread':
      return entity.data.name ?? 'No Subject';
  }
}

function getEntitySearchText(entity: CombinedEntity): string {
  switch (entity.kind) {
    case 'item':
      return entity.data.name;
    case 'user': {
      const { name, email } = entity.data;
      if (name === email) return `${email} | ${email}`;
      return `${name} | ${email}`;
    }
    case 'channel':
      return entity.data.name ?? '';
    case 'company':
      return entity.id;
    case 'thread':
      return entity.data.name ?? '';
  }
}

function getEntityType(entity: CombinedEntity): string {
  switch (entity.kind) {
    case 'user':
      return 'USER';
    case 'channel':
      return 'CHANNEL';
    case 'item':
      if (entity.data.type === 'document' && entity.data.subType === 'task') {
        return 'TASK';
      }
      return entity.data.type.toUpperCase();
    case 'company':
      return 'COMPANY';
    case 'thread':
      return 'THREAD';
  }
}

function getEntityIcon(entity: CombinedEntity) {
  switch (entity.kind) {
    case 'user':
      return (
        <UserIcon
          id={entity.data.id}
          size="xs"
          isDeleted={false}
          suppressClick={true}
        />
      );
    case 'channel':
      switch (entity.data.channel_type) {
        case 'direct_message':
          return <User class={ICON_CLASSES} />;
        case 'private':
          return <ThreeUsersIcon class={ICON_CLASSES} />;
        case 'organization':
          return <ChannelBuildingIcon class={ICON_CLASSES} />;
        case 'public':
          return <GlobeIcon class={ICON_CLASSES} />;
        default:
          return <ChannelIcon class={ICON_CLASSES} />;
      }
    case 'item': {
      const blockName =
        entity.data.type === 'document'
          ? entity.data.subType === 'task'
            ? 'task'
            : fileTypeToBlockName(entity.data.fileType, true)
          : entity.data.type === 'chat'
            ? 'chat'
            : entity.data.type === 'project'
              ? 'project'
              : 'unknown';
      return <EntityIcon targetType={blockName} size="xs" />;
    }
    case 'company':
      return <CompanyIcon class={ICON_CLASSES} />;
    case 'thread':
      return <ThreadIcon class={ICON_CLASSES} />;
  }
}

export function PropertyEntitySelector(props: EntityInputProps) {
  const [inputValue, setInputValue] = createSignal('');
  const [searchTerm, setSearchTerm] = createSignal('');

  // Debounce search term updates (60ms like MentionsMenu)
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );
  createEffect(() => debouncedSetSearchTerm(inputValue()));

  let searchInputRef!: HTMLInputElement;

  // Get current entity context for self-filtering
  const blockId = useBlockId();
  const { entityType: currentEntityType } = usePropertiesContext();

  const history = useHistory();
  const contacts = useContacts();
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();

  // Get current user info for injection into contacts
  const currentUserId = useUserId();
  const [currentUserDisplayName] = useDisplayName(currentUserId());

  // Contacts with current user injected at the beginning
  const contactsWithCurrentUser = createMemo((): IUser[] => {
    const userId = currentUserId();
    if (!userId) return contacts();

    const existingContacts = contacts();

    // Check if current user is already in contacts
    const isCurrentUserInContacts = existingContacts.some(
      (contact) => contact.id === userId
    );
    if (isCurrentUserInContacts) return existingContacts;

    // Inject current user at the beginning
    const currentUser: IUser = {
      id: userId,
      email: idToEmail(userId),
      name: currentUserDisplayName(),
    };
    return [currentUser, ...existingContacts];
  });

  // Fetch emails for browsing (only when THREAD type)
  const emailsQuery = createEmailsInfiniteQuery(() => ({ view: 'all' }), {
    disabled: () => props.property.specificEntityType !== 'THREAD',
  });
  const emails = () => emailsQuery.data ?? [];

  // Server-side email search (query internally disables when < 3 chars)
  const emailSearchQuery = createUnifiedSearchInfiniteQuery(
    () => ({
      params: { page: 0, page_size: 20 },
      request: {
        query: searchTerm(),
        match_type: 'partial' as const,
        include: ['emails' as const],
        search_on: 'name' as const,
      },
    }),
    {
      disabled: () => props.property.specificEntityType !== 'THREAD',
    }
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

  const isLoadingEntities = createMemo(() => {
    if (props.property.specificEntityType === 'THREAD') {
      // Loading if initial emails query is loading OR search is fetching
      return (
        emailsQuery.isLoading ||
        emailsQuery.isPending ||
        emailSearchQuery.isFetching
      );
    }
    return false;
  });

  // Local entities (always available, used for instant results)
  const entities = createMemo(() => {
    const { specificEntityType } = props.property;

    if (!specificEntityType) {
      return [
        ...contactsWithCurrentUser().map(entityMapper('user')),
        ...history().map(entityMapper('item')),
        ...channels().map(entityMapper('channel')),
      ];
    }

    if (specificEntityType === 'USER') {
      return contactsWithCurrentUser().map(entityMapper('user'));
    }

    if (specificEntityType === 'CHANNEL') {
      return channels().map(entityMapper('channel'));
    }

    if (specificEntityType === 'COMPANY') {
      // TODO: Implement company data source
      return [];
    }

    if (specificEntityType === 'THREAD') {
      return emails().map(threadMapper);
    }

    if (specificEntityType === 'TASK') {
      return history()
        .filter((item) => item.type === 'document' && item.subType === 'task')
        .map(entityMapper('item'));
    }

    const itemTypes: EntityType[] = ['DOCUMENT', 'PROJECT', 'CHAT'];
    if (itemTypes.includes(specificEntityType)) {
      return history()
        .filter(
          (item) =>
            item.type.toUpperCase() === specificEntityType &&
            !(item.type === 'document' && item.subType === 'task')
        )
        .map(entityMapper('item'));
    }

    return [];
  });

  const entitySearch = createFreshSearch<CombinedEntity>(
    { timeWeight: 0.1, brevityWeight: 0.3 },
    getEntitySearchText
  );

  const filteredEntities = createMemo(() => {
    const term = searchTerm(); // Already lowercase from debounce
    const allEntities = entities();

    const MAX_VISIBLE_ENTITIES_NO_SEARCH = 50;
    const MAX_SEARCH_RESULTS = 20;

    // Filter out the current entity when selecting same entity type (e.g., parent task on a task)
    const excludeFilter = (e: CombinedEntity) =>
      !(getEntityType(e) === currentEntityType && e.id === blockId);

    // Get visible entities based on search
    const localResults = term
      ? entitySearch(allEntities, term)
          .slice(0, MAX_SEARCH_RESULTS)
          .map((result) => result.item)
          .filter(excludeFilter)
      : allEntities
          .filter(excludeFilter)
          .slice(0, MAX_VISIBLE_ENTITIES_NO_SEARCH);

    // For THREAD: merge local + server results (local first, server appended, deduped)
    if (props.property.specificEntityType === 'THREAD' && term) {
      const localIds = new Set(localResults.map((e) => e.id));
      const serverResults = serverEmails()
        .filter((e) => !localIds.has(e.id))
        .filter(excludeFilter);
      return [...localResults, ...serverResults].slice(0, MAX_SEARCH_RESULTS);
    }

    return localResults;
  });

  // Track searchTerm and filteredEntities, but NOT selectedOptions
  // This keeps list order stable during selection while still reacting to data changes
  const sortedEntities = createMemo(
    on([searchTerm, filteredEntities], () => {
      const term = searchTerm(); // Already lowercase from debounce
      const filteredResults = filteredEntities();

      // When there's a search term, return results as-is
      if (term) {
        return filteredResults;
      }

      // When browsing (no search), show selected entities first
      const selectedIds = props.selectedOptions();
      const entityIdsInResults = new Set(filteredResults.map((e) => e.id));

      // Partition filtered results into selected and unselected
      const selected: CombinedEntity[] = [];
      const unselected: CombinedEntity[] = [];

      for (const entity of filteredResults) {
        if (selectedIds.has(entity.id)) {
          selected.push(entity);
        } else {
          unselected.push(entity);
        }
      }

      // Add missing selected entities from property value (handles pagination)
      if (
        props.property.valueType === 'ENTITY' &&
        props.property.value != null
      ) {
        const allAvailableEntities = entities();

        for (const ref of props.property.value) {
          if (
            selectedIds.has(ref.entity_id) &&
            !entityIdsInResults.has(ref.entity_id)
          ) {
            const actualEntity = allAvailableEntities.find(
              (e) => e.id === ref.entity_id
            );
            if (actualEntity) {
              selected.push(actualEntity);
            }
          }
        }
      }

      return [...selected, ...unselected];
    })
  );

  const toggleEntity = (entity: CombinedEntity) => {
    const newSelected = new Set(props.selectedOptions());
    const isCurrentlySelected = newSelected.has(entity.id);

    if (props.property.isMultiSelect) {
      if (isCurrentlySelected) {
        newSelected.delete(entity.id);
      } else {
        newSelected.add(entity.id);
      }
    } else {
      newSelected.clear();
      newSelected.add(entity.id);
    }

    props.setSelectedOptions(newSelected, [
      {
        id: entity.id,
        entity_type: getEntityType(entity),
      },
    ]);
    props.setHasChanges(true);
  };

  useSearchInputFocus(() => searchInputRef);

  return (
    <div class="space-y-3">
      <div class="space-y-2" data-entity-search>
        <div class="relative">
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
            <SearchIcon class="h-4 w-4 text-ink-muted" />
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            placeholder={`Search ${props.property.valueType === 'ENTITY' ? 'entities' : props.property.valueType + 's'}...`}
            class={`${INPUT_CLASSES} relative z-0`}
          />
        </div>

        <Show when={sortedEntities().length > 0}>
          <div class="max-h-48 overflow-y-auto overflow-x-hidden space-y-1">
            <For each={sortedEntities()}>
              {(entity, _index) => {
                const isSelected = () => props.selectedOptions().has(entity.id);

                return (
                  <div
                    class={`${ENTITY_ITEM_BASE} ${isSelected() ? 'bg-active text-accent-ink' : 'hover:bg-hover text-ink'}`}
                    onClick={() => toggleEntity(entity)}
                    onKeyDown={(e) => e.key === 'Enter' && toggleEntity(entity)}
                  >
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                      <div class="flex-shrink-0">{getEntityIcon(entity)}</div>
                      <span class="text-sm truncate min-w-0">
                        {getEntityName(entity)}
                      </span>
                    </div>
                    <div class="flex-shrink-0">
                      <div
                        class={`${CHECKBOX_BASE} border-edge bg-transparent`}
                      >
                        <Show when={isSelected()}>
                          <CheckIcon class="w-3 h-3 text-accent" />
                        </Show>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={sortedEntities().length === 0}>
          <div class="text-center py-4 text-ink-muted text-sm">
            <Show
              when={!isLoadingEntities()}
              fallback={<span>Loading...</span>}
            >
              No {getEntityTypePluralLabel(props.property.specificEntityType)}{' '}
              found
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
