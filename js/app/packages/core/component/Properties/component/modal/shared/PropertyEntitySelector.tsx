import { useChannelsContext } from '@core/component/ChannelsProvider';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  type ChannelWithParticipants,
  type IUser,
  useContacts,
  useOrganizationUsers,
} from '@core/user';
import { mergeByKey } from '@core/util/compareUtils';
import { createFreshSearch } from '@core/util/freshSort';
import CheckIcon from '@icon/bold/check-bold.svg';
import ChannelBuildingIcon from '@icon/duotone/building-office-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ChannelIcon from '@icon/duotone/hash-duotone.svg';
import User from '@icon/duotone/user-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Item } from '@service-storage/generated/schemas/item';
import { useHistory } from '@service-storage/history';
import { createMemo, createSignal, For, on, Show } from 'solid-js';
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

type EntityMap = {
  item: Item;
  user: IUser;
  channel: ChannelWithParticipants;
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

type EntityMapper<K extends keyof EntityMap> = (
  data: EntityMap[K]
) => PickEntity<K>;

function entityMapper<K extends keyof EntityMap>(kind: K): EntityMapper<K> {
  return (data: EntityMap[K]) => ({ kind, data, id: data.id });
}

const ICON_CLASSES = 'size-4 text-ink-muted';
const INPUT_CLASSES = PROPERTY_STYLES.input.search;
const ENTITY_ITEM_BASE =
  'flex items-center justify-between gap-2 py-1.5 px-2 border border-edge cursor-pointer min-w-0';
const CHECKBOX_BASE = 'w-4 h-4 border flex items-center justify-center';

const getEntityName = (entity: CombinedEntity): string => {
  switch (entity.kind) {
    case 'item':
      return entity.data.name;
    case 'user':
      const { name, email } = entity.data;
      if (name === email) return email;
      return `${name} | ${email}`;
    case 'channel':
      return entity.data.name ?? '';
  }
};

const getEntitySearchText = (entity: CombinedEntity): string => {
  switch (entity.kind) {
    case 'item':
      return entity.data.name;
    case 'user':
      const { name, email } = entity.data;
      if (name === email) return `${email} | ${email}`;
      return `${name} | ${email}`;
    case 'channel':
      return entity.data.name ?? '';
  }
};

const getEntityType = (entity: CombinedEntity): string => {
  switch (entity.kind) {
    case 'user':
      return 'USER';
    case 'channel':
      return 'CHANNEL';
    case 'item':
      // Entity types from backend are already uppercase
      return entity.data.type.toUpperCase();
  }
};

const getEntityIcon = (entity: CombinedEntity) => {
  switch (entity.kind) {
    case 'user':
      return (
        <UserIcon
          id={entity.data.id}
          size="sm"
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
    case 'item':
      const blockName =
        entity.data.type === 'document'
          ? fileTypeToBlockName(entity.data.fileType, true)
          : entity.data.type === 'chat'
            ? 'chat'
            : entity.data.type === 'project'
              ? 'project'
              : 'unknown';
      return <EntityIcon targetType={blockName} size="xs" />;
  }
};

function useEntityData(specificEntityType: EntityType | null | undefined) {
  const history = useHistory();
  const organizationUsers = useOrganizationUsers();
  const contacts = useContacts();
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();

  const entities = createMemo((): CombinedEntity[] => {
    // Only fetch what we need based on specific type
    if (!specificEntityType) {
      // All entities - combine everything
      const allUsers = mergeByKey('id', contacts(), organizationUsers());
      const mapped = [
        ...allUsers.map(entityMapper('user')),
        ...history().map(entityMapper('item')),
        ...channels().map(entityMapper('channel')),
      ];
      return mapped;
    }

    if (specificEntityType === ('USER' as EntityType)) {
      const users = mergeByKey('id', contacts(), organizationUsers());
      return users.map(entityMapper('user'));
    }

    if (specificEntityType === ('CHANNEL' as EntityType)) {
      return channels().map(entityMapper('channel'));
    }

    // include all except thread type
    const itemTypes: EntityType[] = ['DOCUMENT', 'PROJECT', 'CHAT'];
    if (itemTypes.includes(specificEntityType)) {
      return history()
        .filter((item) => item.type.toUpperCase() === specificEntityType)
        .map(entityMapper('item'));
    }

    return [];
  });

  return { entities };
}

export function PropertyEntitySelector(props: EntityInputProps) {
  const [searchTerm, setSearchTerm] = createSignal('');
  const [lastSearchTerm, setLastSearchTerm] = createSignal('');

  let searchInputRef!: HTMLInputElement;

  const { entities } = useEntityData(props.property.specificEntityType);

  const entitySearch = createFreshSearch<CombinedEntity>(
    { timeWeight: 0.1, brevityWeight: 0.3 },
    getEntitySearchText
  );

  const filteredEntities = createMemo(() => {
    const term = searchTerm().toLowerCase();
    const allEntities = entities();

    const MAX_VISIBLE_ENTITIES_NO_SEARCH = 50;
    const MAX_SEARCH_RESULTS = 20;

    // Get visible entities based on search
    const visibleEntities = term
      ? entitySearch(allEntities, term)
          .slice(0, MAX_SEARCH_RESULTS)
          .map((result) => result.item)
      : allEntities.slice(0, MAX_VISIBLE_ENTITIES_NO_SEARCH);

    // When searching, return results as-is (stable order)
    if (term) return visibleEntities;

    // When browsing (no search), return visible entities without sorting
    // Sorting will be handled separately in the render
    return visibleEntities;
  });

  const sortedEntities = createMemo(
    on(searchTerm, () => {
      const term = searchTerm().toLowerCase();
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
            value={searchTerm()}
            onInput={(e) => {
              const newTerm = e.currentTarget.value;
              setSearchTerm(newTerm);
              if (newTerm !== lastSearchTerm()) {
                setLastSearchTerm(newTerm);
              }
            }}
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

        <Show when={sortedEntities().length === 0 && searchTerm()}>
          <div class="text-center py-4 text-ink-muted text-sm">
            No{' '}
            {props.property.valueType === 'ENTITY'
              ? 'entities'
              : props.property.valueType + 's'}{' '}
            found
          </div>
        </Show>
      </div>
    </div>
  );
}
