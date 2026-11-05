import { t } from '@app/lib/i18n';
import type { ListNavActions } from '@core/util/useListKeyBindings';
import CircleDashedEmpty from '@icon/system/regular/circle-dashed.svg';
import { useTeamMembers } from '@queries/team/members';
import { usePinnedContactUsers } from '@queries/contacts/use-directory';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import {
  CommandMenuEmptyState,
  CommandMenuList,
  createCommandListController,
} from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  Match,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import {
  type CombinedEntity,
  getEntityName,
  getEntityType,
} from '../editors/selectors/entityUtils';
import { OptionCheckBox } from '../editors/selectors/OptionCheckBox';
import { scopedUserOptions } from '../editors/selectors/scoped-user-options';
import { usePropertyEntityDisplay } from '../hooks/usePropertyEntityDisplay';
import { useAgentAssignees } from '../queries/agent-assignees';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '../types';
import { useEntitiesForProperty } from './hooks/useEntitiesForProperty';

type EntityPropertyRow =
  | { type: 'clear'; separatorBefore: boolean }
  | {
      type: 'entity';
      entity: CombinedEntity;
      separatorBefore: boolean;
    };

function selectedEntityRefs(
  property: Property | PropertyDefinitionDomain
): EntityReference[] {
  if (!('value' in property) || property.valueType !== 'ENTITY') return [];
  return property.value ?? [];
}

export function EntityPropertyEditor(props: {
  property?: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  onSubmit: (value: EntityReference) => void;
  onSave: (
    apiValues: PropertyApiValues,
    event?: KeyboardEvent | MouseEvent
  ) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
  selectedEntityCount: number;
}) {
  const definitionId = () => {
    const property = props.property;
    if (!property) return '';
    if ('propertyDefinitionId' in property) {
      return property.propertyDefinitionId;
    }

    return property.id;
  };
  const isCompanyOwner = () =>
    definitionId() === SYSTEM_PROPERTY_IDS.COMPANY_OWNER;
  const isAssignees = () => definitionId() === SYSTEM_PROPERTY_IDS.ASSIGNEES;
  const agents = useAgentAssignees(isAssignees);
  const team = useTeamMembers(() => isCompanyOwner() || isAssignees());
  const [localSelectedRefs, setLocalSelectedRefs] = createSignal(
    props.property ? selectedEntityRefs(props.property) : []
  );
  const [orderedSelectedIds, setOrderedSelectedIds] = createSignal(
    localSelectedRefs().map((ref) => ref.entity_id)
  );
  let syncedPropertyId = definitionId();
  let syncedSelectionKey = props.property
    ? selectedEntityRefs(props.property)
        .map((ref) => ref.entity_id)
        .sort()
        .join('\0')
    : '';
  const [openOrderFrozen, setOpenOrderFrozen] = createSignal(false);

  createEffect(() => {
    const propertyId = definitionId();
    const refs = props.property ? selectedEntityRefs(props.property) : [];
    const nextSelectionKey = refs
      .map((ref) => ref.entity_id)
      .sort()
      .join('\0');

    if (propertyId !== syncedPropertyId) {
      syncedPropertyId = propertyId;
      syncedSelectionKey = nextSelectionKey;
      setOpenOrderFrozen(false);
      setLocalSelectedRefs(refs);
      setOrderedSelectedIds(refs.map((ref) => ref.entity_id));
      return;
    }

    if (openOrderFrozen() || nextSelectionKey === syncedSelectionKey) return;

    syncedSelectionKey = nextSelectionKey;
    setLocalSelectedRefs(refs);
    setOrderedSelectedIds(refs.map((ref) => ref.entity_id));
  });

  createEffect(() => {
    const entityTypeLabel =
      props.property?.specificEntityType?.toLowerCase() || 'entity';
    props.setPlaceholder(`Search for ${entityTypeLabel}...`);
  });

  createEffect(() => {
    props.searchValue();
    props.setSelectedIndex(0);
  });

  const selectEntity = (entity: CombinedEntity) => {
    const entityType = getEntityType(entity);
    if (!entityType) return;
    const entityRef: EntityReference = {
      entity_id: entity.id,
      entity_type: entityType,
    };
    props.onSubmit(entityRef);
  };

  const canGroupMultiValues = () => {
    if (!props.property?.isMultiSelect) return false;
    if (props.selectedEntityCount !== 1) return false;

    return 'value' in props.property;
  };

  const localSelectedIds = createMemo(() =>
    localSelectedRefs().map((ref) => ref.entity_id)
  );
  const people = usePinnedContactUsers(localSelectedIds, isAssignees);
  const users = createMemo(() => {
    if (!isCompanyOwner() && !isAssignees()) return undefined;
    const pool = [...agents(), ...team.users()];
    if (!isAssignees()) return pool;
    return scopedUserOptions(
      pool,
      people(),
      localSelectedIds()
    );
  });
  const { entities } = useEntitiesForProperty(
    () => props.property,
    props.searchValue,
    {
      users,
      selectedUserIds: localSelectedIds,
      selectedIds: () => {
        if (!isAssignees()) return undefined;

        return localSelectedIds();
      },
    }
  );

  const orderedEntities = createMemo(() => {
    if (!canGroupMultiValues()) return entities();

    const selectedAtOpen = orderedSelectedIds();
    const selected = entities().filter((entity) =>
      selectedAtOpen.includes(entity.id)
    );
    const remaining = entities().filter(
      (entity) => !selectedAtOpen.includes(entity.id)
    );

    return [...selected, ...remaining];
  });

  const searchQuery = () => props.searchValue().trim();
  const showClearAllRow = () =>
    canGroupMultiValues() && orderedSelectedIds().length > 0;
  const showClearAllAtTop = () => showClearAllRow() && !searchQuery();
  const showClearAllAtBottom = () => showClearAllRow() && !!searchQuery();

  const rows = createMemo(() => {
    const nextRows: EntityPropertyRow[] = [];

    if (showClearAllAtTop()) {
      nextRows.push({ type: 'clear', separatorBefore: false });
    }

    for (const [index, entity] of orderedEntities().entries()) {
      let separatorBefore = false;
      if (canGroupMultiValues() && index > 0) {
        const previous = orderedEntities()[index - 1];
        const selectedAtOpen = orderedSelectedIds();
        separatorBefore =
          selectedAtOpen.includes(previous.id) &&
          !selectedAtOpen.includes(entity.id);
      }

      nextRows.push({ type: 'entity', entity, separatorBefore });
    }

    if (showClearAllAtBottom()) {
      nextRows.push({
        type: 'clear',
        separatorBefore: orderedEntities().length > 0,
      });
    }

    return nextRows;
  });

  const toggleEntity = (
    entity: CombinedEntity,
    event?: KeyboardEvent | MouseEvent
  ) => {
    if (!canGroupMultiValues()) {
      selectEntity(entity);
      return;
    }

    const entityType = getEntityType(entity);
    if (!entityType) return;
    const selectedIds = localSelectedIds();
    setOpenOrderFrozen(true);
    const nextRefs = localSelectedRefs().filter(
      (ref) => ref.entity_id !== entity.id
    );
    if (!selectedIds.includes(entity.id)) {
      nextRefs.push({ entity_id: entity.id, entity_type: entityType });
    }

    setLocalSelectedRefs(nextRefs);
    props.onSave(
      {
        valueType: 'ENTITY',
        refs: nextRefs.length > 0 ? nextRefs : null,
      },
      event
    );
  };

  const clearAllEntities = (event?: KeyboardEvent | MouseEvent) => {
    if (!showClearAllRow()) return;

    setOpenOrderFrozen(true);
    setLocalSelectedRefs([]);
    props.onSave({ valueType: 'ENTITY', refs: null }, event);
  };

  const selectRow = (
    row: EntityPropertyRow,
    event?: KeyboardEvent | MouseEvent
  ) => {
    if (row.type === 'clear') {
      clearAllEntities(event);
      return;
    }

    toggleEntity(row.entity, event);
  };

  const listController = createCommandListController({
    items: rows,
    selectedIndex: props.selectedIndex,
    setSelectedIndex: props.setSelectedIndex,
  });

  props.setKeybindings({
    select: (event) => {
      const row = rows()[props.selectedIndex()];
      if (row) selectRow(row, event);
    },
    next: () => {
      listController.selectNext();
    },
    previous: () => {
      listController.selectPrevious();
    },
  });

  const listId = createUniqueId();
  return (
    <div>
      <Show
        when={rows().length > 0}
        fallback={
          <CommandMenuEmptyState>
            <Switch
              fallback={
                props.searchValue().trim()
                  ? 'No matching entities found'
                  : 'No entities available'
              }
            >
              <Match when={isAssignees() && team.isLoading()}>
                {t('viewMenus.loadingTeamMembers')}
              </Match>
              <Match when={isAssignees() && team.isError()}>
                {t('viewMenus.teamMembersUnavailable')}
              </Match>
            </Switch>
          </CommandMenuEmptyState>
        }
      >
        <Show when={isAssignees() && (team.isLoading() || team.isError())}>
          <div role="status" class="px-3 py-2 text-sm text-ink-muted">
            {team.isLoading()
              ? t('viewMenus.loadingTeamMembers')
              : t('viewMenus.teamMembersUnavailable')}
          </div>
        </Show>
        <CommandMenuList
          items={rows()}
          selectedIndex={props.selectedIndex()}
          scrollSelectedIntoView={listController.shouldScrollSelectedIntoView()}
          itemId={(_, index) => `${listId}-entity-option-${index}`}
          beforeItem={(row) =>
            row.separatorBefore ? (
              <div class="mx-2 my-1 h-px bg-edge-muted/50" />
            ) : null
          }
          onSelect={(row, _, event) => selectRow(row, event)}
          onItemMouseMove={(index) =>
            listController.setSelectedIndexFromPointer(index)
          }
        >
          {(row) => (
            <Switch>
              <Match when={row.type === 'clear'}>
                <CircleDashedEmpty class="size-4 text-ink-muted opacity-50" />
                <span class="min-w-0 flex-1 truncate text-ink-muted">
                  Clear all{' '}
                  {props.property?.displayName.toLowerCase() ?? 'entities'}
                </span>
              </Match>
              <Match when={row.type === 'entity' && row.entity}>
                {(entity) => (
                  <EntityRowContent
                    entity={entity()}
                    multiselect={canGroupMultiValues()}
                    selected={localSelectedIds().includes(entity().id)}
                  />
                )}
              </Match>
            </Switch>
          )}
        </CommandMenuList>
      </Show>
    </div>
  );
}

function EntityRowContent(props: {
  entity: CombinedEntity;
  multiselect?: boolean;
  selected?: boolean;
}) {
  const { icon } = usePropertyEntityDisplay(
    () => props.entity.id,
    () => getEntityType(props.entity)
  );

  return (
    <>
      <Show when={props.multiselect}>
        <OptionCheckBox checked={Boolean(props.selected)} multiselect />
      </Show>
      <span class="size-4 flex items-center justify-center shrink-0">
        {icon()}
      </span>
      <div class="flex-1 text-left">
        <p class="text-sm font-medium">{getEntityName(props.entity)}</p>
      </div>
    </>
  );
}
