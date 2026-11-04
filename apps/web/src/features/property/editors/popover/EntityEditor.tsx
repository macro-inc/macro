import { t } from '@app/lib/i18n';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  entityReferencesToIdSet,
  updateEntityReferences,
} from '@property/utils/entityConversion';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo, createSignal, Show, Suspense } from 'solid-js';
import { useProperty } from '../../core/context';
import { useAgentAssignees } from '../../queries/agent-assignees';
import { useTeamMembers } from '../../queries/team-members';
import type { EntityProperty, PropertyApiValues } from '../../types';
import { isEntityProperty } from '../../utils';
import { useQuickAccessEntities } from '../selectors/entityUtils';
import { PropertyEntitySelector } from '../selectors/PropertyEntitySelector';
import {
  nonTeamUserOptions,
  scopedUserOptions,
} from '../selectors/scoped-user-options';
import { EditorPopover } from './EditorPopover';

type EntityEditorProps = {
  /**
   * Owning entity context for the property — used by PropertyEntitySelector
   * to filter the current entity out of the picker. Omit when no self-filter
   * is needed (e.g. composer with no entity yet).
   */
  selfFilter?: { entityType: EntityType; blockId?: string };
};

/**
 * Popover dropdown for ENTITY properties. Wraps PropertyEntitySelector;
 * saves accumulated selection on close.
 */
export function EntityEditor(props: EntityEditorProps) {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen() && isEntityProperty(ctx.property())}>
      <EntityEditorBody selfFilter={props.selfFilter} />
    </Show>
  );
}

/**
 * The staged selection for an ENTITY property, saved by `closeAndSave`. A
 * component calls it when its editor opens, so each opening starts from the
 * saved value.
 */
function createEntityEditorDraft() {
  const ctx = useProperty();
  const property = ctx.property() as EntityProperty;
  const initialRefs: EntityReference[] = property.value ?? [];
  const [selectedRefs, setSelectedRefs] =
    createSignal<EntityReference[]>(initialRefs);
  const [dirty, setDirty] = createSignal(false);
  const pickedNames = new Map<string, string>();

  const refsEqual = (a: EntityReference[], b: EntityReference[]) => {
    if (a.length !== b.length) return false;
    return a.every((aRef) =>
      b.some(
        (bRef) =>
          aRef.entity_id === bRef.entity_id &&
          aRef.entity_type === bRef.entity_type
      )
    );
  };

  const closeAndSave = async () => {
    if (dirty() && !refsEqual(selectedRefs(), initialRefs)) {
      const refs = selectedRefs();
      const apiValues: PropertyApiValues = {
        valueType: 'ENTITY',
        refs: refs.length > 0 ? refs : null,
      };
      try {
        await ctx.onSave?.(property, apiValues, pickedNames);
      } catch {
        // mutation onError owns toast
      }
    }
    ctx.closeEditor();
  };

  return {
    property,
    selectedRefs,
    select: (
      refs: EntityReference[],
      picked: readonly { id: string; name: string }[] = []
    ) => {
      for (const { id, name } of picked) pickedNames.set(id, name);
      setSelectedRefs(refs);
      setDirty(true);
    },
    closeAndSave,
  };
}

type EntityEditorDraft = ReturnType<typeof createEntityEditorDraft>;

/** The entity picker over a draft, with the project-agents note. */
function EntityEditorSelector(
  props: EntityEditorProps & {
    draft: EntityEditorDraft;
    /** Fill a sized container, such as a sheet, rather than a popover's height. */
    fillHeight?: boolean;
    /** Escape in the search; saves the draft when absent, as a popover does. */
    onCancel?: () => void;
  }
) {
  const property = props.draft.property;

  const isCompanyOwner =
    property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.COMPANY_OWNER;
  const isAssignees =
    property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES;
  const agents = useAgentAssignees(() => isAssignees);
  const team = useTeamMembers(() => isCompanyOwner || isAssignees);
  const [findingOtherPeople, setFindingOtherPeople] = createSignal(false);
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
    if (!isAssignees) return team.users();
    return scopedUserOptions(
      [...agents(), ...team.users()],
      findingOtherPeople() && (team.isLoading() || team.isError())
        ? []
        : people().map((item) => item.data),
      entityReferencesToIdSet(props.draft.selectedRefs()),
      findingOtherPeople()
    );
  });
  const priorityIds = createMemo(
    () =>
      new Set(
        users()
          .filter((user) => isBotPrincipalId(user.id))
          .map((user) => user.id)
      )
  );
  const showRosterStatus = () =>
    (isCompanyOwner || isAssignees) && (team.isLoading() || team.isError());

  const emptyState = () => {
    if (showRosterStatus()) return null;
    if (!isAssignees || !findingOtherPeople()) return undefined;
    if (peopleLoading()) {
      return <div class="px-3 py-4 text-sm text-ink-muted">Loading...</div>;
    }
    if (otherPeople().length > 0) return undefined;
    return (
      <div role="status" class="px-3 py-4 text-sm text-ink-muted">
        {t('viewMenus.noOtherPeople')}
      </div>
    );
  };
  return (
    <>
      <Suspense
        fallback={
          <div class="px-3 py-4 text-sm text-ink-muted">Loading...</div>
        }
      >
        <PropertyEntitySelector
          config={{
            isMultiSelect: property.isMultiSelect,
            placeholder: isAssignees
              ? t(
                  findingOtherPeople()
                    ? 'viewMenus.searchOtherPeople'
                    : 'viewMenus.searchAssignees'
                )
              : `${property.isMultiSelect ? 'Add' : 'Change'} ${property.displayName.toLowerCase()}...`,
            specificEntityType: property.specificEntityType,
            selfFilter: props.selfFilter,
            users: isCompanyOwner || isAssignees ? users : undefined,
            fillHeight: props.fillHeight,
          }}
          priorityIds={isAssignees ? priorityIds() : undefined}
          action={
            isAssignees
              ? {
                  label: t(
                    findingOtherPeople()
                      ? 'viewMenus.backToAssignees'
                      : 'viewMenus.findOtherPeople'
                  ),
                  icon: findingOtherPeople()
                    ? () => <ArrowLeftIcon class="size-4" />
                    : undefined,
                  onSelect: () => setFindingOtherPeople((finding) => !finding),
                }
              : undefined
          }
          emptyState={emptyState()}
          selectedOptions={() =>
            entityReferencesToIdSet(props.draft.selectedRefs())
          }
          setSelectedOptions={(newOptions, entityInfo) => {
            props.draft.select(
              updateEntityReferences(
                props.draft.selectedRefs(),
                newOptions,
                entityInfo
              ),
              entityInfo
            );
          }}
          onClose={props.draft.closeAndSave}
          onCancel={props.onCancel}
        />
      </Suspense>
      <Show when={showRosterStatus()}>
        <div role="status" class="shrink-0 px-3 py-2 text-sm text-ink-muted">
          {team.isLoading()
            ? t('viewMenus.loadingTeamMembers')
            : t('viewMenus.teamMembersUnavailable')}
        </div>
      </Show>
      <Show
        when={
          props.selfFilter?.entityType === 'INITIATIVE' &&
          !findingOtherPeople() &&
          property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
        }
      >
        <p class="border-t border-edge-muted px-3 py-2 text-xs text-ink-muted">
          Agents assigned to this project automatically take on tasks created in
          or moved into it. Use a shared team agent for tasks added by
          teammates.
        </p>
      </Show>
    </>
  );
}

function EntityEditorBody(props: EntityEditorProps) {
  const draft = createEntityEditorDraft();
  return (
    <EditorPopover onClose={draft.closeAndSave}>
      <EntityEditorSelector selfFilter={props.selfFilter} draft={draft} />
    </EditorPopover>
  );
}

/**
 * ENTITY properties in a `PickerSheet` stacked over a touch sheet: picks stay
 * a draft until Done, and Cancel drops them. A single-choice picker applies
 * its pick at once.
 */
export function EntitySheetEditor(props: EntityEditorProps) {
  const ctx = useProperty();
  return (
    <Show when={isEntityProperty(ctx.property())}>
      <PickerSheet.Root open={ctx.editorOpen()} onCancel={ctx.closeEditor}>
        <EntitySheetBody selfFilter={props.selfFilter} />
      </PickerSheet.Root>
    </Show>
  );
}

function EntitySheetBody(props: EntityEditorProps) {
  const ctx = useProperty();
  const draft = createEntityEditorDraft();
  return (
    <>
      <PickerSheet.Header
        title={draft.property.displayName}
        onDone={() => fireAndForget(draft.closeAndSave(), 'property-editor')}
      />
      <PickerSheet.Body>
        <EntityEditorSelector
          selfFilter={props.selfFilter}
          draft={draft}
          fillHeight
          onCancel={ctx.closeEditor}
        />
      </PickerSheet.Body>
    </>
  );
}
