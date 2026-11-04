import { t } from '@app/lib/i18n';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { ListNavActions } from '@core/util/useListKeyBindings';
import CircleDashedEmpty from '@icon/system/regular/circle-dashed.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import {
  CommandMenuEmptyState,
  CommandMenuList,
  createCommandListController,
} from '@ui';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  Match,
  onCleanup,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import {
  type CombinedEntity,
  getEntityName,
  getEntityType,
  useQuickAccessEntities,
} from '../editors/selectors/entityUtils';
import { OptionCheckBox } from '../editors/selectors/OptionCheckBox';
import {
  nonTeamUserOptions,
  scopedUserOptions,
} from '../editors/selectors/scoped-user-options';
import { usePropertyEntityDisplay } from '../hooks/usePropertyEntityDisplay';
import { useAgentAssignees } from '../queries/agent-assignees';
import { useTeamMembers } from '../queries/team-members';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '../types';
import { useEntitiesForProperty } from './hooks/useEntitiesForProperty';

function selectedEntityRefs(
  property: Property | PropertyDefinitionDomain
): EntityReference[] {
  if (!('value' in property) || property.valueType !== 'ENTITY') return [];
  return property.value ?? [];
}

export function EntityPropertyEditor(props: {
  property?: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  setSearchValue: Setter<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  onSubmit: (value: EntityReference) => void;
  onSave: (
    apiValues: PropertyApiValues,
    event?: KeyboardEvent | MouseEvent
  ) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
  setFooterAction: (
    action: { label: string; onSelect: () => void } | undefined
  ) => void;
  selectedEntityCount: number;
}) {
  const definitionId = () => {
    const property = props.property;
    if (!property) return '';
    return 'propertyDefinitionId' in property
      ? property.propertyDefinitionId
      : property.id;
  };
  const isCompanyOwner = () =>
    definitionId() === SYSTEM_PROPERTY_IDS.COMPANY_OWNER;
  const isAssignees = () => definitionId() === SYSTEM_PROPERTY_IDS.ASSIGNEES;
  const [findingOtherPeople, setFindingOtherPeople] = createSignal(false);
  const agents = useAgentAssignees(isAssignees);
  const team = useTeamMembers(() => isCompanyOwner() || isAssignees());
  const [localSelectedRefs, setLocalSelectedRefs] = createSignal(
    props.property ? selectedEntityRefs(props.property) : []
  );
  const [orderedSelectedIds, setOrderedSelectedIds] = createSignal(
    new Set(
      props.property
        ? selectedEntityRefs(props.property).map((ref) => ref.entity_id)
        : []
    )
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
      setFindingOtherPeople(false);
      props.setFooterAction(undefined);
      setLocalSelectedRefs(refs);
      setOrderedSelectedIds(new Set(refs.map((ref) => ref.entity_id)));
      return;
    }

    if (openOrderFrozen() || nextSelectionKey === syncedSelectionKey) return;

    syncedSelectionKey = nextSelectionKey;
    setLocalSelectedRefs(refs);
    setOrderedSelectedIds(new Set(refs.map((ref) => ref.entity_id)));
  });

  createEffect(() => {
    if (isAssignees()) {
      props.setPlaceholder(
        t(
          findingOtherPeople()
            ? 'viewMenus.searchOtherPeople'
            : 'viewMenus.searchAssignees'
        )
      );
      return;
    }
    const entityTypeLabel =
      props.property?.specificEntityType?.toLowerCase() || 'entity';
    props.setPlaceholder(`Search for ${entityTypeLabel}...`);
  });

  const navigate = (discovering: boolean) => {
    batch(() => {
      props.setSearchValue('');
      listController.setSelectedIndex(0, { scrollIntoView: true });
      setFindingOtherPeople(discovering);
      props.setFooterAction(
        discovering
          ? {
              label: t('viewMenus.backToAssignees'),
              onSelect: () => navigate(false),
            }
          : undefined
      );
    });
  };
  onCleanup(() => props.setFooterAction(undefined));

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

  const canGroupMultiValues = () =>
    Boolean(
      props.property?.isMultiSelect &&
        props.selectedEntityCount === 1 &&
        props.property &&
        'value' in props.property
    );

  const localSelectedIds = createMemo(
    () => new Set(localSelectedRefs().map((ref) => ref.entity_id))
  );
  const { items: people, isLoading: peopleLoading } = useQuickAccessEntities(
    () => 'USER'
  );
  const otherPeople = createMemo(() =>
    nonTeamUserOptions(
      [...agents(), ...team.users()],
      people().map((item) => item.data)
    )
  );
  const users = createMemo(() => {
    if (!isCompanyOwner() && !isAssignees()) return undefined;
    const pool = [...agents(), ...team.users()];
    if (!isAssignees()) return pool;
    return scopedUserOptions(
      pool,
      findingOtherPeople() && (team.isLoading() || team.isError())
        ? []
        : people().map((item) => item.data),
      localSelectedIds(),
      findingOtherPeople()
    );
  });
  const priorityIds = createMemo(
    () =>
      new Set(
        users()
          ?.filter((user) => isBotPrincipalId(user.id))
          .map((user) => user.id)
      )
  );
  const { entities } = useEntitiesForProperty(
    () => props.property,
    props.searchValue,
    {
      users,
      selectedIds: () => (isAssignees() ? localSelectedIds() : undefined),
      priorityIds: () => (isAssignees() ? priorityIds() : undefined),
    }
  );

  const orderedEntities = createMemo(() => {
    if (!canGroupMultiValues()) return entities();

    const selectedAtOpen = orderedSelectedIds();
    const selected = entities().filter((entity) =>
      selectedAtOpen.has(entity.id)
    );
    const remaining = entities().filter(
      (entity) => !selectedAtOpen.has(entity.id)
    );

    return [...selected, ...remaining];
  });

  const searchQuery = () => props.searchValue().trim();
  const showClearAllRow = () =>
    !findingOtherPeople() &&
    canGroupMultiValues() &&
    orderedSelectedIds().size > 0;
  const showClearAllAtTop = () => showClearAllRow() && !searchQuery();
  const showClearAllAtBottom = () => showClearAllRow() && !!searchQuery();

  type EntityPropertyRow =
    | { type: 'clear'; separatorBefore: boolean }
    | { type: 'discovery'; separatorBefore: boolean }
    | {
        type: 'entity';
        entity: CombinedEntity;
        separatorBefore: boolean;
      };

  const rows = createMemo(() => {
    const nextRows: EntityPropertyRow[] = [];

    if (showClearAllAtTop()) {
      nextRows.push({ type: 'clear', separatorBefore: false });
    }

    for (const [index, entity] of orderedEntities().entries()) {
      nextRows.push({
        type: 'entity',
        entity,
        separatorBefore:
          canGroupMultiValues() &&
          index > 0 &&
          orderedSelectedIds().has(orderedEntities()[index - 1].id) &&
          !orderedSelectedIds().has(entity.id),
      });
    }

    if (showClearAllAtBottom()) {
      nextRows.push({
        type: 'clear',
        separatorBefore: orderedEntities().length > 0,
      });
    }

    if (isAssignees() && !findingOtherPeople()) {
      nextRows.push({
        type: 'discovery',
        separatorBefore: nextRows.length > 0,
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
    const nextRefs = selectedIds.has(entity.id)
      ? localSelectedRefs().filter((ref) => ref.entity_id !== entity.id)
      : [
          ...localSelectedRefs(),
          {
            entity_id: entity.id,
            entity_type: entityType,
          },
        ];

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

    if (row.type === 'discovery') {
      navigate(true);
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
              <Match when={findingOtherPeople() && peopleLoading()}>
                Loading...
              </Match>
              <Match when={findingOtherPeople() && otherPeople().length === 0}>
                <span role="status">{t('viewMenus.noOtherPeople')}</span>
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
          itemClass={(row) => (row.type === 'discovery' ? 'w-fit' : undefined)}
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
              <Match when={row.type === 'discovery'}>
                <SearchIcon class="size-4 text-ink-muted" />
                <span class="min-w-0 flex-1 truncate text-ink-muted">
                  {t('viewMenus.findOtherPeople')}
                </span>
              </Match>
              <Match when={row.type === 'entity' && row.entity}>
                {(entity) => (
                  <EntityRowContent
                    entity={entity()}
                    multiselect={canGroupMultiValues()}
                    selected={localSelectedIds().has(entity().id)}
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
      <Show when={isBotPrincipalId(props.entity.id)}>
        <span class="shrink-0 text-xs text-ink-muted">Agent</span>
      </Show>
    </>
  );
}
