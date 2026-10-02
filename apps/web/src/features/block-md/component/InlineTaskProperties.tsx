import { ProgressChip } from '@core/component/LexicalMarkdown/component/status/Progress';
import { AddPropertyButton } from '@property/component/AddPropertyButton';
import { Modals } from '@property/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
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
  const pins = createPinnedProperties(() => state.editor.md.editor);
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
      pins.pin(property.propertyId);
      clearPendingPin(property.propertyDefinitionId);
    }
  });

  const inlineProperties = createMemo(() => {
    const props = properties();
    if (documentKind === 'document') {
      return props.filter(
        (property) =>
          pins.ids().includes(property.propertyId) &&
          !property.isMetadata &&
          !tagDefinitionIds().has(property.propertyDefinitionId)
      );
    }
    const ids = [
      SYSTEM_PROPERTY_IDS.STATUS,
      SYSTEM_PROPERTY_IDS.PRIORITY,
      SYSTEM_PROPERTY_IDS.ASSIGNEES,
    ];
    return ids
      .map((id) => props.find((p) => p.propertyDefinitionId === id))
      .filter((p): p is Property => p !== undefined);
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
          pinnedPropertyIds={pins.ids}
          onPropertyPinned={pins.pin}
          onPropertyUnpinned={pins.unpin}
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
                canManage={documentKind === 'document'}
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
