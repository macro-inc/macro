import { useBlockId } from '@core/block';
import LoadingSpinner from '@icon/regular/spinner.svg';
import { type Accessor, createMemo, Show } from 'solid-js';
import { AddPropertyButton } from './components/AddPropertyButton';
import { PropertiesContent } from './components/PropertiesContent';
import { PropertiesModals } from './components/PropertiesModals';
import {
  PropertiesProvider,
  usePropertiesContext,
} from './context/PropertiesContext';
import { useProperties } from './hooks';
import type { PropertiesPanelProps, Property } from './types';

const CONTAINER_CLASSES =
  'h-full overflow-hidden relative font-mono flex flex-col';
const LOADING_CONTAINER_CLASSES = 'flex items-center justify-center py-8';
const SPINNER_CLASSES = 'w-5 h-5 animate-spin';

export function PropertiesView(props: PropertiesPanelProps) {
  const blockId = useBlockId();

  const { properties, isLoading, error, refetch } = useProperties(
    blockId,
    props.entityType,
    true // includeMetadata
  );

  const handleRefresh = () => {
    refetch();
    props.onRefresh?.();
  };

  const handlePropertyAdded = async () => {
    // This is called by context when properties are added via PropertySelector
    // The PropertySelector already handles UI feedback via apiUtils
    handleRefresh();
  };

  const handlePropertyDeleted = async () => {
    // This is called by context when properties are deleted
    // The deletion already handles UI feedback via apiUtils
    handleRefresh();
  };

  return (
    <PropertiesProvider
      entityType={props.entityType}
      canEdit={props.canEdit}
      documentName={props.documentName}
      properties={properties}
      onRefresh={handleRefresh}
      onPropertyAdded={handlePropertyAdded}
      onPropertyDeleted={handlePropertyDeleted}
      onPropertyPinned={props.onPropertyPinned}
      onPropertyUnpinned={props.onPropertyUnpinned}
      pinnedPropertyIds={props.pinnedPropertyIds}
    >
      <div class={CONTAINER_CLASSES}>
        <Show when={isLoading()}>
          <div class={LOADING_CONTAINER_CLASSES}>
            <div class={SPINNER_CLASSES}>
              <LoadingSpinner />
            </div>
          </div>
        </Show>

        <Show when={error()}>
          <div class="text-failure-ink text-center py-4">{error()}</div>
        </Show>

        <PropertiesContent
          properties={properties}
          isLoading={isLoading}
          error={error}
        />

        <AddPropertyButtonWrapper properties={properties} />

        <PropertiesModals />
      </div>
    </PropertiesProvider>
  );
}

function AddPropertyButtonWrapper(props: { properties: Accessor<Property[]> }) {
  const { canEdit, openPropertySelector } = usePropertiesContext();
  const hasProperties = createMemo(() => props.properties().length > 0);

  const handleAddProperty = () => {
    openPropertySelector();
  };

  return (
    <Show when={canEdit && hasProperties()}>
      <div class="flex-shrink-0 p-4">
        <AddPropertyButton onClick={handleAddProperty} />
      </div>
    </Show>
  );
}
