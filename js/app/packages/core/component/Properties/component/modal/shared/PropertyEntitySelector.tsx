import { Entity, type EntityData } from '@entity';
import { UserIcon } from '@core/component/UserIcon';
import { useAugmentUserWithDmActivity } from '@core/user';
import { createFreshSearch } from '@core/util/freshSort';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import { createEmailsInfiniteQuery } from '@macro-entity';
import type { EmailEntity } from '@entity';
import { useSearchSoupQuery } from '@queries/soup/search';
import { useEmail } from '@core/context/user';
import { debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { useSearchInputFocus } from '../../../utils';
import {
  type CombinedEntity,
  createEntitySearchConfig,
  useQuickAccessEntities,
  getEntitySearchText,
  getEntityTimestampedItem,
  getEntityType,
  isChannelEntity,
  threadMapper,
  quickAccessItemToEntity,
  userToEntity,
} from './entityUtils';
import { OptionCheckBox } from './OptionCheckBox';
import { useKeyPressed } from '@core/util/useKeyPressed';
import type { EntitySelectorConfig } from './types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';

type EntityInputProps = {
  config: EntitySelectorConfig;
  selectedOptions: () => Set<string>;
  setSelectedOptions: (
    options: Set<string>,
    entityInfo?: { id: string; entity_type: string }[]
  ) => void;
  onClose?: () => void;
};

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

/** Gets display name for a CombinedEntity */
function getEntityName(entity: CombinedEntity): string {
  if (entity.kind === 'user') {
    const { name, email } = entity.data;
    if (name === email) return email;
    return name;
  }
  const data = entity.data;
  if (data.type === 'email') {
    return data.name ?? 'No Subject';
  }
  return data.name ?? '';
}

const ITEM_SIZE = 32;

export function PropertyEntitySelector(props: EntityInputProps) {
  const [inputValue, setInputValue] = createSignal('');
  const [searchTerm, setSearchTerm] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const keyboardMode = useKeyPressed(100);

  let virtualizerHandle: VirtualizerHandle | undefined;

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

  // Get current user domain for same-domain boost in search
  const currentUserEmail = useEmail();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  // Get items from quickAccess based on entity type
  const { items: quickAccessItems, isLoading: isQuickAccessLoading } =
    useQuickAccessEntities(() => props.config.specificEntityType);

  // Fetch emails for browsing (only when THREAD type or generic ENTITY)
  const needsEmailSearch = () =>
    props.config.specificEntityType === 'THREAD' ||
    !props.config.specificEntityType;

  const emailsQuery = createEmailsInfiniteQuery(() => ({ view: 'all' }), {
    disabled: () => !needsEmailSearch(),
  });
  const emails = () => emailsQuery.data ?? [];

  // Server-side email search (query internally disables when < 3 chars)
  const emailSearchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: 20 },
      body: {
        query: searchTerm(),
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

  const isLoadingEntities = createMemo(() => {
    if (needsEmailSearch()) {
      return (
        emailsQuery.isLoading ||
        emailsQuery.isPending ||
        emailSearchQuery.isFetching
      );
    }
    return isQuickAccessLoading();
  });

  // Convert quickAccess items to CombinedEntity format
  const entities = createMemo((): CombinedEntity[] => {
    const specificEntityType = props.config.specificEntityType;

    // For THREAD type, use email data (not in quickAccess yet)
    if (specificEntityType === 'THREAD') {
      return emails().map(threadMapper);
    }

    // For COMPANY type, return empty (not in quickAccess)
    if (specificEntityType === 'COMPANY') {
      return [];
    }

    // Convert quickAccess items to CombinedEntity
    const items = quickAccessItems();
    const converted: CombinedEntity[] = [];

    for (const item of items) {
      // Augment users with DM activity
      if (item.kind === 'user') {
        const augmentedUser = augmentUserWithDmActivity(item.data);
        converted.push(userToEntity(augmentedUser));
      } else {
        const entity = quickAccessItemToEntity(item);
        // Filter by specific entity type if needed
        if (specificEntityType) {
          const entityType = getEntityType(entity);
          if (entityType === specificEntityType) {
            converted.push(entity);
          }
        } else {
          converted.push(entity);
        }
      }
    }

    // For generic entity type, also include emails
    if (!specificEntityType) {
      converted.push(...emails().map(threadMapper));
    }

    return converted;
  });

  const entitySearch = createFreshSearch<CombinedEntity>(
    createEntitySearchConfig(currentUserDomain),
    getEntitySearchText,
    isChannelEntity,
    getEntityTimestampedItem
  );

  const filteredEntities = createMemo(() => {
    const term = searchTerm();
    const allEntities = entities();

    const MAX_VISIBLE_ENTITIES_NO_SEARCH = 50;
    const MAX_SEARCH_RESULTS = 20;

    // Filter out the current entity when selecting same entity type
    const blockId = selfFilterBlockId();
    const currentEntityType = selfFilterEntityType();
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

    // For THREAD or generic entity: merge local + server results
    if (needsEmailSearch() && term) {
      const localIds = new Set(localResults.map((e) => e.id));
      const serverResults = serverEmails()
        .filter((e) => !localIds.has(e.id))
        .filter(excludeFilter);
      return [...localResults, ...serverResults].slice(0, MAX_SEARCH_RESULTS);
    }

    return localResults;
  });

  // Sort entities with selected items first when not searching
  const sortedEntities = createMemo(
    on([searchTerm, filteredEntities], () => {
      const term = searchTerm();
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

      // Add missing selected entities that aren't in the visible results
      const allAvailableEntities = entities();
      for (const selectedId of selectedIds) {
        if (!entityIdsInResults.has(selectedId)) {
          const actualEntity = allAvailableEntities.find(
            (e) => e.id === selectedId
          );
          if (actualEntity) {
            selected.push(actualEntity);
          }
        }
      }

      return [...selected, ...unselected];
    })
  );

  const toggleEntity = (entity: CombinedEntity) => {
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
      newSelected.add(entity.id);
    }

    props.setSelectedOptions(newSelected, [
      {
        id: entity.id,
        entity_type: getEntityType(entity),
      },
    ]);

    if (!props.config.isMultiSelect && props.onClose) {
      props.onClose();
    } else if (props.config.isMultiSelect && searchInputRef) {
      // Keep input focused when multiselect is enabled
      setTimeout(() => searchInputRef.focus(), 0);
    }
  };

  // Reset selected index when sortedEntities change
  createEffect(() => {
    const entitiesList = sortedEntities();
    if (entitiesList.length === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(Math.min(selectedIndex(), entitiesList.length - 1));
    }
  });

  // Scroll to selected index when it changes
  createEffect(() => {
    const index = selectedIndex();
    if (index >= 0 && virtualizerHandle) {
      virtualizerHandle.scrollToIndex(index, { align: 'nearest' });
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const entitiesList = sortedEntities();
    if (entitiesList.length === 0) return;

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % entitiesList.length);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + entitiesList.length) % entitiesList.length
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedEntity = entitiesList[selectedIndex()];
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
            placeholder={props.config.placeholder}
          />
        </div>
      </div>

      <Show when={sortedEntities().length > 0}>
        <div class="p-1">
          <VList
            ref={(handle) => {
              virtualizerHandle = handle;
            }}
            data={sortedEntities()}
            itemSize={ITEM_SIZE}
            bufferSize={5 * ITEM_SIZE}
            style={{ height: '192px', contain: 'content' }}
            class="overflow-y-auto overflow-x-hidden scrollbar-hidden"
          >
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
                    <div class="size-4 flex-shrink-0">
                      <Show
                        when={entity.kind === 'entity'}
                        fallback={
                          <UserIcon
                            id={entity.id}
                            size="xs"
                            isDeleted={false}
                            suppressClick={true}
                          />
                        }
                      >
                        <Entity.Icon entity={entity.data as EntityData} />
                      </Show>
                    </div>
                    <span class="truncate min-w-0">
                      <Show
                        when={entity.kind === 'entity'}
                        fallback={getEntityName(entity)}
                      >
                        <Entity.Title entity={entity.data as EntityData} />
                      </Show>
                    </span>
                  </div>
                  <div class="flex-shrink-0">
                    <OptionCheckBox
                      checked={isSelected()}
                      multiselect={props.config.isMultiSelect}
                    />
                  </div>
                </div>
              );
            }}
          </VList>
        </div>
      </Show>

      <Show when={sortedEntities().length === 0}>
        <div class="text-center py-4 text-ink-muted text-sm">
          <Show when={!isLoadingEntities()} fallback={<span>Loading...</span>}>
            No {getEntityTypePluralLabel(props.config.specificEntityType)} found
          </Show>
        </div>
      </Show>
    </div>
  );
}
