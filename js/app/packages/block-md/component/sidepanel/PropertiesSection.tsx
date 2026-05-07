import { useBlockAliasedName, useBlockId } from '@core/block';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { Modals } from '@core/component/Properties/component/modal';
import { PanelContainer } from '@core/component/Properties/component/panel';
import { getDefaultPinnedProperties } from '@core/component/Properties/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@core/component/Properties/context/PropertiesContext';
import { useEntityProperties } from '@core/component/Properties/hooks';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import Plus from '@icon/regular/plus.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { mdStore } from '../../signal/markdownBlockData';

interface PropertiesSectionProps {
  canEdit: boolean;
  documentName: string;
}

/**
 * "Properties" section content for the SidePanel — cloned from
 * FrontMatterProperties without the inline collapsible header chrome,
 * since SidePanel.Section provides accordion behavior.
 */
export function PropertiesSection(props: PropertiesSectionProps) {
  const blockId = useBlockId();
  const mdData = mdStore.get;

  const blockName = useBlockAliasedName();
  const entityType: EntityType = blockName === 'task' ? 'TASK' : 'DOCUMENT';

  const { properties, isLoading, error, refetch } = useEntityProperties(
    blockId,
    entityType,
    false
  );

  const [pinnedPropertyIds, setPinnedPropertyIds] = createSignal<string[]>([]);

  createEffect(() => {
    const currentEditor = mdData.editor;
    if (!currentEditor) return;
    currentEditor.getEditorState().read(() => {
      const ids = $getPinnedProperties();
      setPinnedPropertyIds(ids);
    });

    const unregister = currentEditor.registerUpdateListener(
      ({ editorState }) => {
        editorState.read(() => {
          const ids = $getPinnedProperties();
          setPinnedPropertyIds(ids);
        });
      }
    );
    onCleanup(unregister);
  });

  const docMetadataQuery = useDocumentMetadataQuery(() => blockId);
  const createdByProperty = createMemo<Property | null>(() => {
    if (entityType !== 'TASK') return null;
    const ownerId = docMetadataQuery.data?.owner;
    if (!ownerId) return null;
    const now = new Date();
    return {
      propertyId: `${blockId}-created-by`,
      propertyDefinitionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      displayName: 'Created By',
      isMultiSelect: false,
      isMetadata: true,
      owner: { scope: 'system' },
      specificEntityType: 'USER',
      createdAt: now,
      updatedAt: now,
      valueType: 'ENTITY',
      value: [{ entity_id: ownerId, entity_type: 'USER' }],
    };
  });

  const filteredPinnedProperties = createMemo(() => {
    const allProps = properties();
    const pinnedIds = pinnedPropertyIds();
    const defaultPinnedIds = getDefaultPinnedProperties(blockName);

    const pinned = allProps.filter(
      (prop) =>
        !prop.isMetadata &&
        (defaultPinnedIds.includes(prop.propertyDefinitionId) ||
          pinnedIds.includes(prop.propertyId))
    );

    const createdBy = createdByProperty();
    return createdBy ? [createdBy, ...pinned] : pinned;
  });

  const [pendingPinDefIds, setPendingPinDefIds] = createSignal<Set<string>>(
    new Set()
  );

  const handlePropertyAdded = async (addedDefinitionIds?: string[]) => {
    if (addedDefinitionIds && addedDefinitionIds.length > 0) {
      setPendingPinDefIds((prev) => {
        const next = new Set(prev);
        for (const id of addedDefinitionIds) next.add(id);
        return next;
      });
    }
    refetch();
  };

  const handlePropertyDeleted = async () => {
    refetch();
  };

  const handlePropertyPinned = (propertyId: string) => {
    const editor = mdData.editor;
    if (editor) {
      editor.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, propertyId);
    }
  };

  const handlePropertyUnpinned = (propertyId: string) => {
    const editor = mdData.editor;
    if (editor) {
      editor.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, propertyId);
    }
  };

  createEffect(() => {
    const pending = pendingPinDefIds();
    if (pending.size === 0) return;
    const current = properties();
    const remaining = new Set(pending);
    for (const defId of pending) {
      const instance = current.find((p) => p.propertyDefinitionId === defId);
      if (instance) {
        handlePropertyPinned(instance.propertyId);
        remaining.delete(defId);
      }
    }
    if (remaining.size !== pending.size) {
      setPendingPinDefIds(remaining);
    }
  });

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        { entityId: blockId, entityType, property, apiValues },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Show
      when={!error()}
      fallback={
        <div class="text-failure-ink text-center py-4 text-xs">{error()}</div>
      }
    >
      <Suspense>
        <PropertiesProvider
          entityType={entityType}
          canEdit={props.canEdit}
          documentName={props.documentName}
          properties={filteredPinnedProperties}
          onRefresh={refetch}
          onPropertyAdded={handlePropertyAdded}
          onPropertyDeleted={handlePropertyDeleted}
          onPropertyPinned={handlePropertyPinned}
          onPropertyUnpinned={handlePropertyUnpinned}
          pinnedPropertyIds={pinnedPropertyIds}
          saveHandler={saveHandler}
        >
          <Show when={isLoading()}>
            <div class="flex items-center justify-center py-8">
              <div class="w-5 h-5 animate-spin">
                <LoadingSpinner />
              </div>
            </div>
          </Show>

          <Show when={filteredPinnedProperties().length > 0}>
            <PanelContainer
              properties={filteredPinnedProperties}
              isLoading={isLoading}
              error={error}
            />
          </Show>

          <Show when={props.canEdit}>
            <div class="py-2">
              <AddPinnedPropertyButton />
            </div>
          </Show>
          <Modals />
        </PropertiesProvider>
      </Suspense>
    </Show>
  );
}

function AddPinnedPropertyButton() {
  const { openPropertySelector } = usePropertiesContext();
  return (
    <button
      class="flex items-center gap-1 opacity-75 hover:opacity-50 transition-opacity"
      onClick={openPropertySelector}
    >
      <Plus class="w-3 h-3 mr-2" />
      <span class="text-ink-muted">Add property</span>
    </button>
  );
}
