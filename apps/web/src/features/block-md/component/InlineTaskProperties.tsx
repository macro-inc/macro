import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ProgressChip } from '@core/component/LexicalMarkdown/component/status/Progress';
import { enableProjects } from '@core/constant/featureFlags';
import { buildTaskProjectDefaultProperty } from '@entity/extractors-property';
import { AddPropertyButton } from '@property/component/AddPropertyButton';
import { Modals } from '@property/component/modal';
import {
  getBuiltinPropertyIds,
  getDefaultPinnedProperties,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import { resolvePinnedPropertyIds } from '@property/core/pinned-property-ids';
import { useEntityProperties } from '@property/hooks';
import { InlineFetchedEntityTagsPill } from '@property/tags';
import type { Property, PropertyApiValues } from '@property/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useTagsQuery } from '@queries/properties/tags';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  Suspense,
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
  const projects = useFeatureFlag(enableProjects);
  const defaultDefinitionIds = () =>
    documentKind === 'task'
      ? [
          ...getDefaultPinnedProperties('task'),
          ...(projects().enabled ? [SYSTEM_PROPERTY_IDS.PROJECT] : []),
        ]
      : [];
  const pins = createPinnedProperties(
    () => state.editor.md.editor,
    defaultDefinitionIds
  );
  const titleProperties = () => {
    const fetched = properties();
    return documentKind === 'task' &&
      projects().enabled &&
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
    refetch();
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
        !tagDefinitionIds().has(property.propertyDefinitionId) &&
        !(
          documentKind === 'task' &&
          !projects().enabled &&
          property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
        )
    );
    if (documentKind !== 'task') return visible;
    const order = [
      ...getDefaultPinnedProperties('task'),
      SYSTEM_PROPERTY_IDS.PROJECT,
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
            class="bg-surface-2"
            showAddButton={documentKind === 'document' && canEdit()}
          />
          <For each={inlineProperties()}>
            {(property) => (
              <InlinePropertyValue
                property={property}
                entityId={blockId}
                class="bg-surface-2 border border-edge"
                canManage={
                  !property.propertyId.startsWith('pending:') ||
                  defaultDefinitionIds().includes(property.propertyDefinitionId)
                }
                canRemove={
                  !property.propertyId.startsWith('pending:') &&
                  (documentKind !== 'task' ||
                    !getBuiltinPropertyIds('task').includes(
                      property.propertyDefinitionId
                    ))
                }
              />
            )}
          </For>
          <Show when={documentKind === 'document' && canEdit()}>
            <AddPropertyButton class="gap-1.5 bg-surface-2" />
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
