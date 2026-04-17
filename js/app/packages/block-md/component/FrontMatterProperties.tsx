import { useBlockAliasedName, useBlockId } from '@core/block';
import { isMobile } from '@core/mobile/isMobile';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  dispatchInternalLayoutShift,
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
import { useSaveEntityPropertyMutation } from '@queries/properties/entity';
import CaretDown from '@icon/bold/caret-down-bold.svg';
import CaretRight from '@icon/bold/caret-right-bold.svg';
import EyeSlash from '@icon/bold/eye-slash-bold.svg';
import Plus from '@icon/regular/plus.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import {
  frontMatterPreference,
  setFrontMatterPreferenceForDoc,
} from '../signal/frontMatter';
import { mdStore } from '../signal/markdownBlockData';

interface FrontMatterPropertiesProps {
  canEdit: boolean;
  documentName: string;
  fallback: JSX.Element;
}

export function FrontMatterProperties(props: FrontMatterPropertiesProps) {
  const blockId = useBlockId();
  const mdData = mdStore.get;

  const blockName = useBlockAliasedName();
  const entityType: EntityType = blockName === 'task' ? 'TASK' : 'DOCUMENT';

  const layoutShift = () => {
    if (mdData.editor) {
      dispatchInternalLayoutShift(mdData.editor);
    }
  };

  const { properties, isLoading, error, refetch } = useEntityProperties(
    blockId,
    entityType,
    false
  );

  // Track expanded/collapsed state from persisted preference
  // Default to collapsed on mobile, expanded on desktop
  const isExpanded = createMemo(() => {
    const preference = frontMatterPreference[blockId];
    return preference === undefined ? !isMobile() : preference;
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

  // Filter properties to show default pinned and user-pinned properties
  const filteredPinnedProperties = createMemo(() => {
    const allProps = properties();
    const pinnedIds = pinnedPropertyIds();
    const defaultPinnedIds = getDefaultPinnedProperties(blockName);

    return allProps.filter(
      (prop) =>
        defaultPinnedIds.includes(prop.propertyDefinitionId) ||
        pinnedIds.includes(prop.propertyId)
    );
  });

  // Track properties added via the selector so we can pin them as soon as
  // the refetched property list includes them.
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

  // Once a just-added property shows up in the refetched list, pin it and
  // drop it from the pending set.
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

  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const containerSize = createElementSize(containerRef);
  const height = () => containerSize.height;
  createEffect(on(height, layoutShift));

  const saveMutation = useSaveEntityPropertyMutation();

  // Network-based save handler for FrontMatter properties
  const saveHandler: PropertySaveHandler = {
    saveProperty: (property: Property, value: PropertyApiValues) =>
      saveMutation.mutateAsync({
        entityId: blockId,
        entityType,
        property,
        apiValues: value,
      }),
    saveDate: (property: Property, date: Date) =>
      saveMutation.mutateAsync({
        entityId: blockId,
        entityType,
        property,
        apiValues: {
          valueType: 'DATE',
          value: date,
        },
      }),
  };

  return (
    <Show when={!error()} fallback={props.fallback}>
      <Suspense>
        <div class="mt-6 mb-6" ref={setContainerRef}>
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
            {/* Collapsible header with horizontal line */}
            <div class="flex items-center gap-2 pt-2">
              <div class="w-6 border-t border-edge-muted" />
              <button
                class="flex items-center gap-1 px-2 hover:opacity-70 transition-opacity"
                onClick={toggleExpanded}
              >
                {isExpanded() ? (
                  <CaretDown class="w-3 h-3" />
                ) : (
                  <CaretRight class="w-3 h-3" />
                )}
                <span class="text-xs">Properties</span>
              </button>
              <div class="flex-1 border-t border-edge-muted" />
            </div>

            {/* Collapsible content */}
            <Show when={isExpanded()}>
              <div class="py-2 text-xs">
                <Show when={isLoading()}>
                  <div class="flex items-center justify-center py-8">
                    <div class="w-5 h-5 animate-spin">
                      <LoadingSpinner />
                    </div>
                  </div>
                </Show>

                <Show when={error()}>
                  <div class="text-failure-ink text-center py-4">{error()}</div>
                </Show>

                <Show when={filteredPinnedProperties().length > 0}>
                  <PanelContainer
                    properties={filteredPinnedProperties}
                    isLoading={isLoading}
                    error={error}
                  />
                </Show>

                <Show when={props.canEdit}>
                  <div class="pt-2">
                    <AddPinnedPropertyButton />
                  </div>
                </Show>

                <div class="pt-4 pb-2">
                  <button
                    class="flex items-center gap-1 opacity-75 hover:opacity-50 transition-opacity"
                    onClick={toggleExpanded}
                  >
                    <EyeSlash class="w-3 h-3 mr-2" />
                    <span class="text-ink-muted">Hide Properties</span>
                  </button>
                </div>

                <Modals />
              </div>
              <div class="border-t border-edge-muted pt-2" />
            </Show>
          </PropertiesProvider>
        </div>
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
