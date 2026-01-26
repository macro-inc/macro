import { useMaybeBlockId } from '@core/block';
import {
  useChannelsContext,
  useDmActivityByUserId,
} from '@core/context/channels';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { IUser } from '@core/user';
import { idToEmail, tryMacroId, useContacts, useDisplayName } from '@core/user';
import { createFreshSearch } from '@core/util/freshSort';
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
import { useEmail, useUserId } from '@core/context/user';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { useHistoryQuery } from '@queries/history/history';
import { debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { usePropertiesContext } from '../../../context/PropertiesContext';
import type { Property } from '../../../types';
import { useSearchInputFocus } from '../../../utils';
import {
  type CombinedEntity,
  createEntitySearchConfig,
  entityMapper,
  getEntityName,
  getEntitySearchText,
  getEntityType,
  threadMapper,
} from './entityUtils';
import { OptionCheckBox } from './OptionCheckBox';
import { useKeyPressed } from '@core/util/useKeyPressed';

type EntityInputProps = {
  property: Property;
  selectedOptions: () => Set<string>;
  setSelectedOptions: (
    options: Set<string>,
    entityInfo?: { id: string; entity_type: string }[]
  ) => void;
  setHasChanges: (hasChanges: boolean) => void;
  onClose?: () => void;
};

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
          ? entity.data.subType !== null &&
            entity.data.subType !== undefined &&
            entity.data.subType.type === 'task'
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
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const keyboardMode = useKeyPressed(100);

  // Debounce search term updates (60ms like MentionsMenu)
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );
  createEffect(() => debouncedSetSearchTerm(inputValue()));

  let searchInputRef!: HTMLInputElement;

  // Get current entity context for self-filtering
  const blockId = useMaybeBlockId();
  const { entityType: currentEntityType } = usePropertiesContext();

  const historyQuery = useHistoryQuery();
  const contacts = useContacts();
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;
  const dmActivityByUserId = useDmActivityByUserId();

  // Get current user info for injection into contacts
  const currentUserId = useUserId();
  const [currentUserDisplayName] = useDisplayName(
    tryMacroId(currentUserId() ?? '')
  );

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
  // Email queries for THREAD type or generic ENTITY (no specific type)
  const needsEmailSearch = () =>
    props.property.specificEntityType === 'THREAD' ||
    !props.property.specificEntityType;

  const emailsQuery = createEmailsInfiniteQuery(() => ({ view: 'all' }), {
    disabled: () => !needsEmailSearch(),
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
      disabled: () => !needsEmailSearch(),
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
    if (needsEmailSearch()) {
      // Loading if initial emails query is loading OR search is fetching
      return (
        emailsQuery.isLoading ||
        emailsQuery.isPending ||
        emailSearchQuery.isFetching
      );
    }
    return false;
  });

  // Helper to augment user entities with DM activity timestamps (same as MentionsMenu)
  const augmentUsersWithDmActivity = (users: IUser[]) => {
    const dmActivity = dmActivityByUserId();
    return users.map(entityMapper('user')).map((entity) => {
      const dmTimestamp = dmActivity.get(entity.id);
      if (dmTimestamp) {
        return {
          ...entity,
          lastInteraction: dmTimestamp,
        };
      }
      return entity;
    });
  };

  // Local entities (always available, used for instant results)
  const entities = createMemo(() => {
    const { specificEntityType } = props.property;

    if (!specificEntityType) {
      return [
        ...augmentUsersWithDmActivity(contactsWithCurrentUser()),
        ...(historyQuery.data ?? []).map(entityMapper('item')),
        ...channels().map(entityMapper('channel')),
        ...emails().map(threadMapper),
      ];
    }

    if (specificEntityType === 'USER') {
      return augmentUsersWithDmActivity(contactsWithCurrentUser());
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
      return (historyQuery.data ?? [])
        .filter(
          (item) =>
            item.type === 'document' &&
            item.subType !== null &&
            item.subType !== undefined &&
            item.subType.type === 'task'
        )
        .map(entityMapper('item'));
    }

    const itemTypes: EntityType[] = ['DOCUMENT', 'PROJECT', 'CHAT'];
    if (itemTypes.includes(specificEntityType)) {
      return (historyQuery.data ?? [])
        .filter(
          (item) =>
            item.type.toUpperCase() === specificEntityType &&
            !(
              item.type === 'document' &&
              item.subType !== null &&
              item.subType !== undefined &&
              item.subType.type === 'task'
            )
        )
        .map(entityMapper('item'));
    }

    return [];
  });

  // Get current user domain for same-domain boost
  const currentUserEmail = useEmail();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  const entitySearch = createFreshSearch<CombinedEntity>(
    createEntitySearchConfig(currentUserDomain),
    getEntitySearchText
  );

  const filteredEntities = createMemo(() => {
    const term = searchTerm(); // Already lowercase from debounce
    const allEntities = entities();

    const MAX_VISIBLE_ENTITIES_NO_SEARCH = 50;
    const MAX_SEARCH_RESULTS = 20;

    // Filter out the current entity when selecting same entity type (e.g., parent task on a task)
    const excludeFilter = blockId
      ? (e: CombinedEntity) =>
          !(getEntityType(e) === currentEntityType && e.id === blockId)
      : () => true;

    // Get visible entities based on search
    const localResults = term
      ? entitySearch(allEntities, term)
          .slice(0, MAX_SEARCH_RESULTS)
          .map((result) => result.item)
          .filter(excludeFilter)
      : allEntities
          .filter(excludeFilter)
          .slice(0, MAX_VISIBLE_ENTITIES_NO_SEARCH);

    // For THREAD or generic entity: merge local + server results (local first, server appended, deduped)
    if (needsEmailSearch() && term) {
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

    if (!props.property.isMultiSelect && props.onClose) {
      props.onClose();
    } else if (props.property.isMultiSelect && searchInputRef) {
      // Keep input focused when multiselect is enabled
      setTimeout(() => searchInputRef.focus(), 0);
    }
  };

  // Reset selected index when sortedEntities change
  createEffect(() => {
    const entities = sortedEntities();
    if (entities.length === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(Math.min(selectedIndex(), entities.length - 1));
    }
  });

  const scrollSelectedIntoView = () => {
    const entities = sortedEntities();
    const currentIndex = selectedIndex();
    if (currentIndex >= 0 && currentIndex < entities.length) {
      const element = document.querySelector(
        `[data-entity-index="${currentIndex}"]`
      );
      if (element) {
        element.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const entities = sortedEntities();
    if (entities.length === 0) return;

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % entities.length);
      scrollSelectedIntoView();
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + entities.length) % entities.length
      );
      scrollSelectedIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedEntity = entities[selectedIndex()];
      if (selectedEntity) {
        toggleEntity(selectedEntity);
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  useSearchInputFocus(() => searchInputRef);

  return (
    <div>
      <div class="relative">
        <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
          <SearchIcon class="h-4 w-4 text-ink-muted" />
          <input
            class="w-full caret-accent"
            ref={searchInputRef}
            type="text"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (props.onClose) {
                  props.onClose();
                }
              }
            }}
            placeholder={`${props.property.isMultiSelect ? 'Add' : 'Change'} ${props.property.displayName.toLowerCase()}...`}
          />
        </div>
      </div>

      <Show when={sortedEntities().length > 0}>
        <div class="p-1">
          <div class="max-h-48 overflow-y-auto overflow-x-hidden scrollbar-hidden">
            <For each={sortedEntities()}>
              {(entity, index) => {
                const isSelected = () => props.selectedOptions().has(entity.id);
                const isKeyboardSelected = () => index() === selectedIndex();

                return (
                  <div
                    data-entity-index={index()}
                    class="flex items-center justify-between gap-2 py-1.5 px-2 min-w-0 h-8"
                    classList={{
                      'bg-hover': isKeyboardSelected(),
                      'bg-accent/10': isSelected(),
                    }}
                    onClick={() => toggleEntity(entity)}
                    onKeyDown={(e) => e.key === 'Enter' && toggleEntity(entity)}
                    onMouseEnter={() => {
                      if (!keyboardMode()) {
                        setSelectedIndex(index());
                      }
                    }}
                  >
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                      <div class="flex-shrink-0">{getEntityIcon(entity)}</div>
                      <span class="truncate min-w-0">
                        {getEntityName(entity)}
                      </span>
                    </div>
                    <div class="flex-shrink-0">
                      <OptionCheckBox
                        checked={isSelected()}
                        multiselect={props.property.isMultiSelect}
                      />
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      <Show when={sortedEntities().length === 0}>
        <div class="text-center py-4 text-ink-muted text-sm">
          <Show when={!isLoadingEntities()} fallback={<span>Loading...</span>}>
            No {getEntityTypePluralLabel(props.property.specificEntityType)}{' '}
            found
          </Show>
        </div>
      </Show>
    </div>
  );
}
