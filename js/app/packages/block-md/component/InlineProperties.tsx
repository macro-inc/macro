import { useBlockId } from '@core/block';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import {
  PropertiesProvider,
  usePropertiesContext,
} from '@core/component/Properties/context/PropertiesContext';
import { EntityValueDisplay } from '@core/component/Properties/EntityValueDisplay';
import { useProperties } from '@core/component/Properties/hooks';
import {
  extractDomain,
  formatPropertyValue,
} from '@core/component/Properties/utils';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { mdStore } from '../signal/markdownBlockData';
import { propertiesRefreshSignal } from '../signal/propertiesRefresh';

interface InlinePropertiesProps {
  canEdit: boolean;
  documentName: string;
  fallback: JSX.Element;
}

// Standard metadata properties that don't need labels
const STANDARD_METADATA_NAMES = ['Owner', 'Created At', 'Last Updated'];

function isStandardMetadata(property: {
  displayName: string;
  isMetadata?: boolean;
}): boolean {
  return (
    property.isMetadata === true &&
    STANDARD_METADATA_NAMES.includes(property.displayName)
  );
}

// Helper component to handle property value clicks with context
function InlinePropertyValue(props: {
  property: any;
  displayValue: string | null;
}) {
  const { openDatePicker, openPropertyEditor } = usePropertiesContext();

  const handleClick = (e: MouseEvent) => {
    if (props.property.valueType === 'DATE') {
      openDatePicker(props.property, e.currentTarget as HTMLElement);
    } else if (
      props.property.valueType === 'SELECT_STRING' ||
      props.property.valueType === 'SELECT_NUMBER' ||
      props.property.valueType === 'ENTITY'
    ) {
      openPropertyEditor(props.property, e.currentTarget as HTMLElement);
    }
  };

  const isClickable = () => {
    return (
      props.property.valueType === 'DATE' ||
      props.property.valueType === 'SELECT_STRING' ||
      props.property.valueType === 'SELECT_NUMBER' ||
      props.property.valueType === 'ENTITY'
    );
  };

  return (
    <Show
      when={isClickable()}
      fallback={<span class="text-ink">{props.displayValue || '—'}</span>}
    >
      <button
        onClick={handleClick}
        class="text-ink hover:bg-hover cursor-pointer px-1 py-0.5 rounded"
      >
        {props.displayValue || '—'}
      </button>
    </Show>
  );
}

// Helper component to handle entity value clicks
function InlineEntityValue(props: {
  property: any;
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const { openPropertyEditor } = usePropertiesContext();
  const entities = () =>
    (props.property.value as EntityReference[] | undefined) ?? [];

  const handleEntityClick = (e: MouseEvent) => {
    // Don't handle clicks if they're on a link (BlockLink handles navigation)
    const target = e.target as HTMLElement;
    if (target.closest('a')) {
      return;
    }
    // Always allow clicking to open modal, even for metadata properties
    openPropertyEditor(props.property, e.currentTarget as HTMLElement);
  };

  // For inline display, we want entity values to be clickable
  // So we wrap EntityValueDisplay in a clickable element
  return (
    <div class="flex items-center gap-1">
      <For each={entities()}>
        {(entityRef) => (
          <div onClick={handleEntityClick} class="cursor-pointer">
            <EntityValueDisplay
              property={props.property}
              entityId={entityRef.entity_id}
              entityType={entityRef.entity_type}
              canEdit={false}
            />
          </div>
        )}
      </For>
    </div>
  );
}

export function InlineProperties(props: InlinePropertiesProps) {
  const blockId = useBlockId();
  const mdData = mdStore.get;

  const { properties, isLoading, error, refetch } = useProperties(
    blockId,
    'DOCUMENT' as EntityType,
    true // includeMetadata
  );

  // Watch for property changes from MarkdownPropertiesModal and refetch
  createEffect(() => {
    const shouldRefresh = propertiesRefreshSignal.get();
    if (shouldRefresh) {
      propertiesRefreshSignal.set(false);
      refetch();
    }
  });

  // Track pinned property IDs from Lexical - reactively updates on editor state changes
  const [pinnedPropertyIds, setPinnedPropertyIds] = createSignal<string[]>([]);

  // Set up reactive listener for Lexical state changes
  createEffect(() => {
    const currentEditor = mdData.editor;
    if (!currentEditor) return;
    // Initial load - read from current editor state
    currentEditor.getEditorState().read(() => {
      const ids = $getPinnedProperties();
      setPinnedPropertyIds(ids);
    });

    // Register listener for state updates (including from other users)
    const unregister = currentEditor.registerUpdateListener(
      ({ editorState }) => {
        editorState.read(() => {
          const ids = $getPinnedProperties();
          setPinnedPropertyIds(ids);
        });
      }
    );

    return () => {
      unregister();
    };
  });

  // Filter properties to show metadata/system properties and pinned ones
  const filteredPinnedProperties = createMemo(() => {
    const allProps = properties();
    const pinnedIds = pinnedPropertyIds();

    return allProps.filter(
      (prop) =>
        (prop.isMetadata || pinnedIds.includes(prop.propertyId)) &&
        !(prop.displayName === 'Document Name')
    );
  });

  const handlePropertyAdded = async () => {
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

  return (
    <Show when={!error()} fallback={props.fallback}>
      <PropertiesProvider
        entityType={'DOCUMENT' as EntityType}
        canEdit={props.canEdit}
        documentName={props.documentName}
        properties={filteredPinnedProperties}
        onRefresh={refetch}
        onPropertyAdded={handlePropertyAdded}
        onPropertyDeleted={handlePropertyDeleted}
        onPropertyPinned={handlePropertyPinned}
        onPropertyUnpinned={handlePropertyUnpinned}
        pinnedPropertyIds={pinnedPropertyIds}
      >
        <Show when={!isLoading() && filteredPinnedProperties().length > 0}>
          <div class="flex items-center gap-3 text-sm">
            <For each={filteredPinnedProperties()}>
              {(property, index) => {
                const isStandard = isStandardMetadata(property);
                const showLabel = !isStandard;

                // Format value for display
                const displayValue = createMemo(() => {
                  if (property.valueType === 'ENTITY') {
                    // For entity types (like Owner), we'll render EntityValueDisplay
                    return null;
                  }
                  if (
                    property.valueType === 'DATE' &&
                    property.value instanceof Date
                  ) {
                    return formatPropertyValue(property, property.value);
                  }
                  if (
                    property.valueType === 'SELECT_STRING' ||
                    property.valueType === 'SELECT_NUMBER'
                  ) {
                    const values = property.value as string[] | undefined;
                    if (!values || values.length === 0) return null;
                    return values
                      .map((id) => formatPropertyValue(property, id))
                      .join(', ');
                  }
                  if (property.valueType === 'BOOLEAN') {
                    return formatPropertyValue(property, property.value);
                  }
                  if (property.valueType === 'NUMBER') {
                    return formatPropertyValue(property, property.value);
                  }
                  if (property.valueType === 'STRING') {
                    return formatPropertyValue(property, property.value);
                  }
                  if (property.valueType === 'LINK') {
                    const links = property.value as string[] | undefined;
                    if (!links || links.length === 0) return null;
                    return links.map((url) => extractDomain(url)).join(', ');
                  }
                  return null;
                });

                return (
                  <>
                    {index() > 0 && <span class="text-ink-muted">·</span>}
                    <div class="flex items-center gap-1.5">
                      <Show when={showLabel}>
                        <span class="text-ink-muted">
                          {property.displayName}:
                        </span>
                      </Show>
                      <Show
                        when={property.valueType === 'ENTITY'}
                        fallback={
                          <InlinePropertyValue
                            property={property}
                            displayValue={displayValue()}
                          />
                        }
                      >
                        <InlineEntityValue
                          property={property}
                          canEdit={props.canEdit}
                          onRefresh={refetch}
                        />
                      </Show>
                    </div>
                  </>
                );
              }}
            </For>
          </div>
        </Show>
      </PropertiesProvider>
    </Show>
  );
}
