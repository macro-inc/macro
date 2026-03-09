import { Entity, type EntityData } from '@entity';
import { UserIcon } from '@core/component/UserIcon';
import { useAugmentUserWithDmActivity } from '@core/user';
import { createFreshSearch } from '@core/util/freshSort';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import { createEmailsInfiniteQuery } from '@macro-entity';
import type { EmailEntity } from '@entity';
import { useSearchSoupQuery } from '@queries/soup/search';
import { useEmail, useUserId } from '@core/context/user';
import { debounce } from '@solid-primitives/scheduled';
import {
  For,
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
  sortEntitiesWithSelfFirst,
} from './entityUtils';
import { OptionCheckBox } from './OptionCheckBox';
import { useKeyPressed } from '@core/util/useKeyPressed';
import type { EntitySelectorConfig, PinnedOption } from './types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';

type EntityInputProps = {
  config: EntitySelectorConfig;
  selectedOptions: () => Set<string>;
  setSelectedOptions: (
    options: Set<string>,
    entityInfo?: { id: string; entity_type: string }[]
  ) => void;
  onClose?: () => void;
  pinnedOptions?: PinnedOption[];
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
    return `${name} | ${email}`;
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

  // Pinned options filtered by search term
  const visiblePinnedOptions = createMemo(() => {
    const options = props.pinnedOptions ?? [];
    const term = searchTerm();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term));
  });
  const pinnedCount = () => visiblePinnedOptions().length;

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

  // Get current user info for same-domain boost and self-boost in search
  const currentUserEmail = useEmail();
  const currentUserId = useUserId();
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

  const entitySearch = createFreshSearch<CombinedEntity>({
    config: createEntitySearchConfig(currentUserDomain, currentUserId),
    getName: getEntitySearchText,
    isChannelItem: isChannelEntity,
    getTimestamp: getEntityTimestampedItem,
  });

  const filteredEntities = createMemo(() => {
    const term = searchTerm();
    const allEntities = entities();
    const userId = currentUserId();

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
    // Sort self to top BEFORE slicing to ensure self appears even if not in top 50 by default
    const localResults = term
      ? entitySearch(allEntities, term)
          .slice(0, MAX_SEARCH_RESULTS)
          .map((result) => result.item)
          .filter(excludeFilter)
      : sortEntitiesWithSelfFirst(
          allEntities.filter(excludeFilter),
          userId
        ).slice(0, MAX_VISIBLE_ENTITIES_NO_SEARCH);

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

      // When browsing (no search), show selected entities first, then others
      // (self is already sorted to top within filteredEntities)
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

  const togglePinnedOption = (option: PinnedOption) => {
    const newSelected = new Set(props.selectedOptions());
    if (newSelected.has(option.id)) {
      newSelected.delete(option.id);
    } else {
      if (!props.config.isMultiSelect) newSelected.clear();
      newSelected.add(option.id);
    }
    props.setSelectedOptions(newSelected);

    if (!props.config.isMultiSelect && props.onClose) {
      props.onClose();
    } else if (props.config.isMultiSelect && searchInputRef) {
      setTimeout(() => searchInputRef.focus(), 0);
    }
  };

  const totalCount = () => pinnedCount() + sortedEntities().length;

  // Reset selected index to top when search term or list changes
  createEffect(() => {
    searchTerm(); // track search term changes
    totalCount(); // track list size changes
    setSelectedIndex(0);
  });

  // Scroll VList to selected index (offset by pinned count)
  createEffect(() => {
    const index = selectedIndex();
    const pCount = pinnedCount();
    if (index >= pCount && virtualizerHandle) {
      virtualizerHandle.scrollToIndex(index - pCount, { align: 'nearest' });
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const total = totalCount();
    if (total === 0) return;

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % total);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = selectedIndex();
      const pCount = pinnedCount();
      if (idx < pCount) {
        togglePinnedOption(visiblePinnedOptions()[idx]);
      } else {
        const entity = sortedEntities()[idx - pCount];
        if (entity) toggleEntity(entity);
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

      <Show when={totalCount() > 0}>
        <div class="p-1">
          <For each={visiblePinnedOptions()}>
            {(option, i) => {
              const isSelected = () => props.selectedOptions().has(option.id);
              const isKeyboardSelected = () => i() === selectedIndex();

              return (
                <div
                  class="flex items-center justify-between gap-2 py-1.5 px-2 min-w-0 h-8"
                  classList={{
                    'bg-hover': isKeyboardSelected(),
                    'bg-accent/10': isSelected(),
                  }}
                  onClick={() => togglePinnedOption(option)}
                  onMouseEnter={() => {
                    if (!keyboardMode()) {
                      setSelectedIndex(i());
                    }
                  }}
                >
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div class="size-4 flex-shrink-0">{option.icon}</div>
                    <span class="truncate min-w-0">{option.label}</span>
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
          </For>
          <Show when={sortedEntities().length > 0}>
            <VList
              ref={(handle) => {
                virtualizerHandle = handle;
              }}
              data={sortedEntities()}
              itemSize={ITEM_SIZE}
              bufferSize={5 * ITEM_SIZE}
              style={{
                height: `${Math.min(sortedEntities().length * ITEM_SIZE, 192)}px`,
                contain: 'content',
              }}
              class="overflow-y-auto overflow-x-hidden scrollbar-hidden"
            >
              {(entity, index) => {
                const adjustedIndex = () => index() + pinnedCount();
                const isSelected = () => props.selectedOptions().has(entity.id);
                const isKeyboardSelected = () =>
                  adjustedIndex() === selectedIndex();

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
                        setSelectedIndex(adjustedIndex());
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
          </Show>
        </div>
      </Show>

      <Show when={totalCount() === 0}>
        <div class="text-center py-4 text-ink-muted text-sm">
          <Show when={!isLoadingEntities()} fallback={<span>Loading...</span>}>
            No {getEntityTypePluralLabel(props.config.specificEntityType)} found
          </Show>
        </div>
      </Show>
    </div>
  );
}
