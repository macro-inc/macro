import { ProgressChip } from '@core/component/LexicalMarkdown/component/status/Progress';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  buildStartDateDefaultProperty,
  buildTaskProjectDefaultProperty,
} from '@entity/extractors-property';
import { AddPropertyButton } from '@property/component/AddPropertyButton';
import { Modals } from '@property/component/modal';
import {
  getDefaultPinnedProperties,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import { resolvePinnedPropertyIds } from '@property/core/pinned-property-ids';
import { startDueEditorFor } from '@property/editors/popover/start-due-editor-for';
import { useEntityProperties } from '@property/hooks';
import { useStartDateEnabled } from '@property/hooks/useStartDateEnabled';
import { InlineFetchedEntityTagsPill } from '@property/tags';
import type {
  DateProperty,
  Property,
  PropertyApiValues,
} from '@property/types';
import { isDateProperty } from '@property/utils';
import {
  type DateField,
  dateFieldOf,
  formatStartDue,
  startDueOf,
} from '@property/utils/start-due';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { isTemporaryGraphqlProperty } from '@queries/properties/graphql-optimistic';
import { useTagsQuery } from '@queries/properties/tags';
import { Key } from '@solid-primitives/keyed';
import {
  createEffect,
  createMemo,
  createSignal,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { createPinnedProperties } from '../primitives/create-pinned-properties';
import { InlinePropertyValue } from './InlinePropertyValue';
import { useMarkdownName } from './MarkdownNameProvider';

/**
 * Inline document metadata and the task's status, priority, and assignees.
 */
export function InlineTaskProperties() {
  const { documentId, kind, permissions, state } = useMarkdownDocument();
  const canEdit = permissions.canEdit;
  const blockId = documentId();
  const documentKind = kind();
  const { displayName: documentName } = useMarkdownName();
  const entityType = documentKind === 'task' ? 'TASK' : 'DOCUMENT';

  const { properties, refetch, addProperty, removeProperty } =
    useEntityProperties(blockId, entityType, false);
  const defaultDefinitionIds = () =>
    documentKind === 'task'
      ? [...getDefaultPinnedProperties('task'), SYSTEM_PROPERTY_IDS.PROJECT]
      : [];
  const pins = createPinnedProperties(
    () => state.editor.md.editor,
    defaultDefinitionIds
  );
  const titleProperties = () => {
    const fetched = properties();
    return documentKind === 'task' &&
      !fetched.some(
        (property) =>
          property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
      )
      ? [...fetched, buildTaskProjectDefaultProperty()]
      : fetched;
  };
  const titlePinnedIds = () =>
    resolvePinnedPropertyIds(
      titleProperties(),
      pins.ids(),
      defaultDefinitionIds()
    );
  const tagSets = useTagsQuery();
  const tagDefinitionIds = () =>
    new Set(
      tagSets.isSuccess ? tagSets.data.map((set) => set.definition?.id) : []
    );
  const [pendingPins, setPendingPins] = createSignal(new Set<string>());
  const propertyAdded = (definitionIds?: string[]) => {
    if (definitionIds?.length) {
      setPendingPins((pending) => new Set([...pending, ...definitionIds]));
    }
    fireAndForget(refetch(), 'inline-task-property-added-refresh');
  };
  const clearPendingPin = (definitionId: string) => {
    setPendingPins((pending) => {
      const next = new Set(pending);
      next.delete(definitionId);
      return next;
    });
  };
  // Property assignment IDs arrive from the server; persist each requested pin
  // to the editor once its assignment exists and the editor is ready.
  createEffect(() => {
    if (pendingPins().size === 0 || !state.editor.md.editor) return;
    for (const property of properties()) {
      if (!pendingPins().has(property.propertyDefinitionId)) continue;
      // A value saved straight after the add shows with a temporary id first.
      if (isTemporaryGraphqlProperty(property.propertyId)) continue;
      pins.pin(property.propertyId, titleProperties());
      clearPendingPin(property.propertyDefinitionId);
    }
  });

  const inlineProperties = createMemo(() => {
    const selected = titlePinnedIds();
    const visible = titleProperties().filter(
      (property) =>
        selected.includes(property.propertyId) &&
        !property.isMetadata &&
        property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.TIME_LOGGED &&
        !tagDefinitionIds().has(property.propertyDefinitionId)
    );
    if (documentKind !== 'task') return visible;
    const order: readonly string[] = [
      SYSTEM_PROPERTY_IDS.STATUS,
      SYSTEM_PROPERTY_IDS.PRIORITY,
      SYSTEM_PROPERTY_IDS.DUE_DATE,
      SYSTEM_PROPERTY_IDS.PROJECT,
      SYSTEM_PROPERTY_IDS.ASSIGNEES,
    ];
    return [...visible].sort((left, right) => {
      const leftIndex = order.indexOf(left.propertyDefinitionId);
      const rightIndex = order.indexOf(right.propertyDefinitionId);
      return (
        (leftIndex < 0 ? order.length : leftIndex) -
        (rightIndex < 0 ? order.length : rightIndex)
      );
    });
  });
  const shouldShowRow = createMemo(
    () =>
      documentKind === 'task' ||
      documentKind === 'document' ||
      inlineProperties().length > 0
  );

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [{ entityId: blockId, entityType, property, apiValues }],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  // A task's start and due dates share one picker, and the due date's pill
  // reads as their range once a start is set.
  const startDateEnabled = useStartDateEnabled();
  // While Unlink saves, both dates read as cleared, so the pill steps from the
  // range straight to empty; a failed save drops this and the dates return.
  const [unlinkingDates, setUnlinkingDates] = createSignal(false);
  const shownDate = <T extends Property>(property: T): T =>
    unlinkingDates() &&
    isDateProperty(property) &&
    dateFieldOf(property.propertyDefinitionId)
      ? { ...property, value: null }
      : property;
  const dateEnd = (field: DateField): DateProperty | undefined => {
    const definitionId =
      field === 'start'
        ? SYSTEM_PROPERTY_IDS.START_DATE
        : SYSTEM_PROPERTY_IDS.DUE_DATE;
    const property =
      titleProperties().find(
        (candidate) => candidate.propertyDefinitionId === definitionId
      ) ?? (field === 'start' ? buildStartDateDefaultProperty() : undefined);
    return property && isDateProperty(property)
      ? shownDate(property)
      : undefined;
  };
  const datesText = (property: Property) => {
    if (
      documentKind !== 'task' ||
      !startDateEnabled() ||
      property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.DUE_DATE
    ) {
      return undefined;
    }
    return formatStartDue(startDueOf(dateEnd('start'), property));
  };
  // Unlink on the dates pill clears what it shows: both ends, as Clear both.
  const datesUnlink = (property: Property) => {
    if (
      documentKind !== 'task' ||
      !startDateEnabled() ||
      property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.DUE_DATE
    ) {
      return undefined;
    }
    const setEnds = () =>
      (['start', 'due'] as const)
        .map(dateEnd)
        .filter(
          (end): end is DateProperty =>
            !!end && !end.propertyId.startsWith('pending:') && end.value != null
        );
    return {
      available: () => setEnds().length > 0,
      clear: async () => {
        const ends = setEnds();
        setUnlinkingDates(true);
        try {
          await saveMutation.mutateAsync({
            properties: ends.map((end) => ({
              entityId: blockId,
              entityType,
              property: end,
              apiValues: { valueType: 'DATE' as const, value: null },
            })),
          });
        } finally {
          setUnlinkingDates(false);
        }
      },
    };
  };
  const datesEditor = (definitionId: string) => {
    const field = dateFieldOf(definitionId);
    if (documentKind !== 'task' || !field) return undefined;
    return startDueEditorFor({
      field,
      enabled: startDateEnabled,
      other: () => dateEnd(field === 'due' ? 'start' : 'due'),
      saveOther: (property, value) => saveOne(property, value),
    });
  };

  return (
    <Suspense>
      <Show when={shouldShowRow()}>
        <PropertiesProvider
          entityId={blockId}
          entityType={entityType}
          canEdit={canEdit()}
          documentName={documentName()}
          properties={properties}
          addProperty={addProperty}
          removeProperty={removeProperty}
          pinnedPropertyIds={titlePinnedIds}
          onPropertyPinned={(id) => pins.pin(id, titleProperties())}
          onPropertyUnpinned={(id, definitionId) =>
            pins.unpin(id, titleProperties(), definitionId)
          }
          onRefresh={refetch}
          onPropertyAdded={propertyAdded}
          onPropertyAddFailed={clearPendingPin}
          onPropertyDeleted={refetch}
          saveHandler={saveHandler}
        >
          <InlineFetchedEntityTagsPill
            entityId={blockId}
            entityType={entityType}
            variant="secondary"
            size="xs"
            class={documentKind === 'task' ? 'touch:min-h-9' : undefined}
            showAddButton={documentKind === 'document' && canEdit()}
          />
          {/* A placeholder keeps its chip, and a pick in it, when saving assigns its ID. */}
          <Key each={inlineProperties()} by="propertyDefinitionId">
            {(property) => {
              // Keyed by definition, so one editor serves the pill throughout.
              const editor = datesEditor(
                untrack(() => property().propertyDefinitionId)
              );
              return (
                <InlinePropertyValue
                  property={shownDate(property())}
                  entityId={blockId}
                  showLabel={
                    documentKind === 'task' &&
                    property().propertyDefinitionId ===
                      SYSTEM_PROPERTY_IDS.DUE_DATE
                      ? false
                      : undefined
                  }
                  canManage={
                    !property().propertyId.startsWith('pending:') ||
                    defaultDefinitionIds().includes(
                      property().propertyDefinitionId
                    )
                  }
                  valueText={datesText(shownDate(property()))}
                  editor={editor}
                  unlink={datesUnlink(property())}
                />
              );
            }}
          </Key>
          <Show when={documentKind === 'document' && canEdit()}>
            <AddPropertyButton variant="secondary" size="xs" class="gap-1.5" />
          </Show>
          <Show when={documentKind === 'task' && state.editor.md.progressStats}>
            {(progressStats) => (
              <Show when={progressStats().total > 0}>
                <ProgressChip stats={progressStats()} />
              </Show>
            )}
          </Show>
          <Modals />
        </PropertiesProvider>
      </Show>
    </Suspense>
  );
}
