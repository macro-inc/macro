import { PickerSheet } from '@components/app/mobile/PickerSheet';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { fireAndForget } from '@core/util/fireAndForget';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  entityReferencesToIdSet,
  updateEntityReferences,
} from '@property/utils/entityConversion';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createSignal, Show, Suspense } from 'solid-js';
import { useProperty } from '../../core/context';
import { useAgentAssignees } from '../../queries/agent-assignees';
import type { EntityProperty, PropertyApiValues } from '../../types';
import { isEntityProperty } from '../../utils';
import { PropertyEntitySelector } from '../selectors/PropertyEntitySelector';
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
        await ctx.onSave?.(property, apiValues);
      } catch {
        // mutation onError owns toast
      }
    }
    ctx.closeEditor();
  };

  return {
    property,
    selectedRefs,
    select: (refs: EntityReference[]) => {
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

  // Company owners are always teammates, so the owner picker offers the
  // team roster instead of the default quick-access people pool.
  const isCompanyOwner =
    property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.COMPANY_OWNER;
  const agents = useAgentAssignees(
    () => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
  );
  const teamQuery = useCurrentTeamQuery();
  const teamMembers = (): IUser[] =>
    (teamQuery.data?.members ?? []).map((member) => ({
      id: member.user_id,
      email: idToEmail(member.user_id),
      name: idToDisplayName(member.user_id),
    }));

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
            placeholder: `${property.isMultiSelect ? 'Add' : 'Change'} ${property.displayName.toLowerCase()}...`,
            specificEntityType: property.specificEntityType,
            selfFilter: props.selfFilter,
            users: isCompanyOwner ? teamMembers : undefined,
            additionalUsers: agents,
            fillHeight: props.fillHeight,
          }}
          selectedOptions={() =>
            entityReferencesToIdSet(props.draft.selectedRefs())
          }
          setSelectedOptions={(newOptions, entityInfo) => {
            props.draft.select(
              updateEntityReferences(
                props.draft.selectedRefs(),
                newOptions,
                entityInfo
              )
            );
          }}
          onClose={props.draft.closeAndSave}
          onCancel={props.onCancel}
        />
      </Suspense>
      <Show
        when={
          props.selfFilter?.entityType === 'INITIATIVE' &&
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
