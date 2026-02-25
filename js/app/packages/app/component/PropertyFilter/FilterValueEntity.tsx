import {
  type CombinedEntity,
  createEntitySearchConfig,
  useQuickAccessEntities,
  getEntityName,
  getEntitySearchText,
  getEntityTimestampedItem,
  getEntityType,
  isChannelEntity,
  threadMapper,
  quickAccessItemToEntity,
  userToEntity,
} from '@core/component/Properties/component/modal/shared/entityUtils';
import { usePropertyEntityDisplay } from '@core/component/Properties/hooks/usePropertyEntityDisplay';
import { useAugmentUserWithDmActivity } from '@core/user';
import { useEmail } from '@core/context/user';
import { createFreshSearch } from '@core/util/freshSort';
import { createEmailsInfiniteQuery } from '@macro-entity';
import type { EmailEntity } from '@entity';
import { useSearchSoupQuery } from '@queries/soup/search';
import XIcon from '@phosphor-icons/core/assets/regular/x.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { debounce } from '@solid-primitives/scheduled';
import type { Component } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { EntityFilterValue } from '../PropertyFilterTypes';

export type FilterValueEntityProps = {
  specificEntityType: EntityType;
  values: EntityFilterValue[];
  onChange: (values: EntityFilterValue[]) => void;
};

/** Pill component that uses usePropertyEntityDisplay for proper name/icon resolution */
const EntityPill: Component<{
  value: EntityFilterValue;
  onRemove: () => void;
}> = (props) => {
  const { name, icon, isLoading } = usePropertyEntityDisplay(
    () => props.value.entityId,
    () => props.value.entityType
  );

  return (
    <div class="group relative h-6 px-1.5 text-xxs text-ink border border-edge bg-panel font-mono flex items-center gap-1.5">
      <span class="size-3 flex items-center justify-center shrink-0">
        {icon()}
      </span>
      <span class="whitespace-nowrap max-w-[80px] truncate">
        {isLoading() ? 'Loading...' : name()}
      </span>
      {/* X shows on hover, overlays the text */}
      <button
        type="button"
        onClick={props.onRemove}
        class="absolute inset-0 flex items-center justify-end pr-1 bg-gradient-to-l from-panel via-panel to-transparent opacity-0 group-hover:opacity-100 hover:text-failure-ink"
      >
        <XIcon class="size-3" />
      </button>
    </div>
  );
};

export const FilterValueEntity: Component<FilterValueEntityProps> = (props) => {
  const [isAdding, setIsAdding] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchTerm, setSearchTerm] = createSignal('');

  // Debounce search term updates (same as PropertyEntitySelector)
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );
  createEffect(() => debouncedSetSearchTerm(searchQuery()));

  let inputRef!: HTMLInputElement;
  let containerRef!: HTMLDivElement;
  let dropdownRef!: HTMLDivElement;

  const augmentUserWithDmActivity = useAugmentUserWithDmActivity();

  // Get current user domain for same-domain boost in search
  const currentUserEmail = useEmail();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  // Get items from quickAccess based on entity type
  const { items: quickAccessItems } = useQuickAccessEntities(
    () => props.specificEntityType
  );

  // Email queries for THREAD type or generic ENTITY (no specific type)
  const needsEmailSearch = () =>
    props.specificEntityType === 'THREAD' || !props.specificEntityType;

  const emailsQuery = createEmailsInfiniteQuery(() => ({ view: 'all' }), {
    disabled: () => !needsEmailSearch(),
  });
  const emails = () => emailsQuery.data ?? [];

  // Server-side email search
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

  // Convert quickAccess items to CombinedEntity format
  const entities = createMemo((): CombinedEntity[] => {
    const specificEntityType = props.specificEntityType;

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

  // Search function for fuzzy matching (same config as PropertyEntitySelector)
  const entitySearch = createFreshSearch<CombinedEntity>(
    createEntitySearchConfig(currentUserDomain),
    getEntitySearchText,
    isChannelEntity,
    getEntityTimestampedItem
  );

  // Get selected entity IDs for filtering
  const selectedIds = createMemo(
    () => new Set(props.values.map((v) => v.entityId))
  );

  // Get available options (not already selected, filtered by search)
  const availableEntities = createMemo(() => {
    const query = searchTerm();
    const ids = selectedIds();
    const available = entities().filter((e) => !ids.has(e.id));

    const MAX_RESULTS = 50;

    if (!query) return available.slice(0, MAX_RESULTS);

    // Local search results
    const localResults = entitySearch(available, query)
      .slice(0, MAX_RESULTS)
      .map((result) => result.item);

    // For THREAD or generic entity: merge local + server results (local first, server appended, deduped)
    if (needsEmailSearch() && query) {
      const localIds = new Set(localResults.map((e) => e.id));
      const serverResults = serverEmails().filter(
        (e) => !localIds.has(e.id) && !ids.has(e.id)
      );
      return [...localResults, ...serverResults].slice(0, MAX_RESULTS);
    }

    return localResults;
  });

  const handleAddClick = () => {
    setIsAdding(true);
    setSearchQuery('');
    setTimeout(() => inputRef?.focus(), 0);
  };

  const handleSelectEntity = (entity: CombinedEntity) => {
    if (!selectedIds().has(entity.id)) {
      const newValue: EntityFilterValue = {
        entityId: entity.id,
        entityType: getEntityType(entity),
      };
      props.onChange([...props.values, newValue]);
    }
    setSearchQuery('');
    setIsAdding(false);
  };

  const handleRemoveValue = (entityId: string) => {
    props.onChange(props.values.filter((v) => v.entityId !== entityId));
  };

  // Close when clicking outside
  const handleClickOutside = (event: MouseEvent) => {
    if (!isAdding()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;

    const isInsideContainer = containerRef?.contains(target);
    const isInsideDropdown = dropdownRef?.contains(target);

    if (!isInsideContainer && !isInsideDropdown) {
      setIsAdding(false);
      setSearchQuery('');
    }
  };

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside);
    });
  });

  const getPlaceholderText = () => {
    const type = props.specificEntityType?.toLowerCase() ?? '';
    if (props.values.length === 0) {
      return `Select ${type}...`;
    }
    return '+';
  };

  return (
    <div class="flex flex-wrap items-center gap-0.5 min-w-0">
      {/* Selected value pills - uses usePropertyEntityDisplay for proper resolution */}
      <For each={props.values}>
        {(value) => (
          <EntityPill
            value={value}
            onRemove={() => handleRemoveValue(value.entityId)}
          />
        )}
      </For>

      {/* Add button / input */}
      <div ref={containerRef} class="relative flex items-center">
        <Show
          when={isAdding()}
          fallback={
            <button
              type="button"
              onClick={handleAddClick}
              class="h-6 px-2 text-xxs text-ink-muted border border-edge hover:bg-hover font-mono flex items-center"
            >
              {getPlaceholderText()}
            </button>
          }
        >
          <input
            ref={inputRef}
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search..."
            class="h-6 px-2 min-w-16 w-fit text-xxs text-ink border border-edge hover:bg-hover focus:ring-1 focus:ring-accent font-mono placeholder:text-ink-muted"
          />
          <div
            ref={dropdownRef}
            class="absolute left-0 top-full mt-1 border border-edge bg-menu shadow-lg font-mono min-w-[200px] max-h-48 overflow-y-auto z-1"
          >
            <Show
              when={availableEntities().length > 0}
              fallback={
                <div class="px-3 py-2 text-xxs text-ink-muted text-center">
                  {entities().length === 0
                    ? 'No entities available'
                    : searchQuery()
                      ? 'No matches'
                      : 'All selected'}
                </div>
              }
            >
              <For each={availableEntities()}>
                {(entity) => (
                  <DropdownEntityRow
                    entity={entity}
                    onSelect={() => handleSelectEntity(entity)}
                  />
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};

/** Dropdown row that uses usePropertyEntityDisplay for proper icon resolution */
const DropdownEntityRow: Component<{
  entity: CombinedEntity;
  onSelect: () => void;
}> = (props) => {
  const { icon } = usePropertyEntityDisplay(
    () => props.entity.id,
    () => getEntityType(props.entity)
  );

  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onSelect();
      }}
      class="w-full px-2 py-1.5 text-xxs text-ink hover:bg-hover text-left flex items-center gap-2"
    >
      <span class="size-3 flex items-center justify-center shrink-0">
        {icon()}
      </span>
      <span class="truncate">{getEntityName(props.entity)}</span>
    </button>
  );
};
