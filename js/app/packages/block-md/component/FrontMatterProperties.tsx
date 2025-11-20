import { useBlockId } from '@core/block';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  dispatchInternalLayoutShift,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { Modals } from '@core/component/Properties/component/modal';
import { PanelContainer } from '@core/component/Properties/component/panel';
import { PropertiesProvider } from '@core/component/Properties/context/PropertiesContext';
import { useEntityProperties } from '@core/component/Properties/hooks';
import CaretDown from '@icon/bold/caret-down-bold.svg';
import CaretRight from '@icon/bold/caret-right-bold.svg';
import EyeSlash from '@icon/bold/eye-slash-bold.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  frontMatterPreference,
  setFrontMatterPreferenceForDoc,
} from '../signal/frontMatter';
import { mdStore } from '../signal/markdownBlockData';
import { propertiesRefreshSignal } from '../signal/propertiesRefresh';

interface FrontMatterPropertiesProps {
  canEdit: boolean;
  documentName: string;
  fallback: JSX.Element;
}

export function FrontMatterProperties(props: FrontMatterPropertiesProps) {
  const blockId = useBlockId();
  const mdData = mdStore.get; // Access block store at component level
  const layoutShift = () => {
    if (mdData.editor) {
      dispatchInternalLayoutShift(mdData.editor);
    }
  };

  const { properties, isLoading, error, refetch } = useEntityProperties(
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
      layoutShift();
    }
  });

  // Track expanded/collapsed state from persisted preference
  const isExpanded = createMemo(() => {
    const preference = frontMatterPreference[blockId];
    return preference === undefined ? true : preference;
  });

  const toggleExpanded = () => {
    setFrontMatterPreferenceForDoc(blockId, !isExpanded());
    layoutShift();
  };

  // Track pinned property IDs from Lexical - reactively updates on editor state changes
  const [pinnedPropertyIds, setPinnedPropertyIds] = createSignal<string[]>([]);

  // Set up reactive listener for Lexical state changes
  createEffect(() => {
    const currentEditor = mdData.editor; // Use the block store reference
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
    onCleanup(unregister);
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
      layoutShift();
    }
  };

  const handlePropertyUnpinned = (propertyId: string) => {
    const editor = mdData.editor;
    if (editor) {
      editor.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, propertyId);
      layoutShift();
    }
  };

  return (
    <Show when={!error()} fallback={props.fallback}>
      <div class="mt-6 mb-6">
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
          {/* Collapsible header with horizontal line */}
          <div class="flex items-center gap-2 pt-2">
            <div class="w-8 border-t-2 border-edge" />
            <button
              class="flex items-center gap-1 px-2 cursor-pointer hover:opacity-70 transition-opacity"
              onClick={toggleExpanded}
            >
              {isExpanded() ? (
                <CaretDown class="w-3 h-3" />
              ) : (
                <CaretRight class="w-3 h-3" />
              )}
              <span class="text-sm font-mono">Properties</span>
            </button>
            <div class="flex-1 border-t-2 border-edge" />
          </div>

          {/* Collapsible content */}
          <Show when={isExpanded()}>
            <div class="font-mono pt-2 pb-2 px-4">
              <Show when={isLoading()}>
                <div class="flex items-center justify-center py-8">
                  <div class="w-5 h-5 animate-spin">
                    <LoadingSpinner />
                  </div>
                </div>
              </Show>

              {/* Shouldn't really go in here, but leaving it here as fail safe */}
              <Show when={error()}>
                <div class="text-failure-ink text-center py-4">{error()}</div>
              </Show>

              <PanelContainer
                properties={filteredPinnedProperties}
                isLoading={isLoading}
                error={error}
                emptyMessage="No properties pinned yet"
              />

              <div class="pl-2 pt-4 pb-2">
                <button
                  class="flex items-center gap-1 cursor-pointer opacity-75 hover:opacity-50 transition-opacity"
                  onClick={toggleExpanded}
                >
                  <EyeSlash class="w-3 h-3 mr-2" />
                  <span class="text-sm text-ink font-mono">
                    Hide Properties
                  </span>
                </button>
              </div>

              <Modals />
            </div>
            <div class="border-t-2 border-edge pt-2" />
          </Show>
        </PropertiesProvider>
      </div>
    </Show>
  );
}
