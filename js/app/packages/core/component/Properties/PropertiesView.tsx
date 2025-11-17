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
      <PropertiesViewContent
        properties={properties}
        isLoading={isLoading}
        error={error}
        canEdit={props.canEdit}
      />
    </PropertiesProvider>
  );
}

// Separated to allow context access while keeping PropertiesView clean
function PropertiesViewContent(props: {
  properties: Accessor<Property[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  canEdit: boolean;
}) {
  const { openPropertySelector } = usePropertiesContext();
  const hasProperties = createMemo(() => props.properties().length > 0);

  return (
    <div class={CONTAINER_CLASSES}>
      <Show when={props.isLoading()}>
        <div class={LOADING_CONTAINER_CLASSES}>
          <div class={SPINNER_CLASSES}>
            <LoadingSpinner />
          </div>
        </div>
      </Show>

      <Show when={props.error()}>
        <div class="text-failure-ink text-center py-4">{props.error()}</div>
      </Show>

      <PropertiesContent
        properties={props.properties}
        isLoading={props.isLoading}
        error={props.error}
      />

      <Show when={props.canEdit && hasProperties()}>
        <div class="flex-shrink-0 p-4">
          <AddPropertyButton onClick={openPropertySelector} />
        </div>
      </Show>

      <PropertiesModals />
    </div>
  );
}
