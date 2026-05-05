import { useBlockId } from '@core/block';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { useListKeyBindings } from '@core/util/useListKeyBindings';
import LoadingSpinner from '@icon/regular/spinner.svg';
import PlusIcon from '@icon/regular/plus.svg';
import { Dialog } from '@kobalte/core/dialog';
import { useAddEntityPropertyMutation } from '@queries/properties/entity';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { cn } from '@ui/utils/classname';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  Show,
} from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import { usePropertySelection } from '../../hooks/usePropertySelection';
import type {
  PropertyDefinitionDomain,
  PropertySelectorProps,
} from '../../types';
import {
  getPropertyDefinitionTypeDisplay,
  PropertyDataTypeIcon,
  toPropertyDefinitionDomain,
  useSearchInputFocus,
} from '../../utils';
import { Panel } from '@ui';

export function SelectPropertyModal(props: PropertySelectorProps) {
  const blockId = useBlockId();
  const { entityType, onPropertyAdded, openCreateProperty } =
    usePropertiesContext();

  const [searchQuery, setSearchQuery] = createSignal('');
  const [focusedIndex, setFocusedIndex] = createSignal(0);

  const [dialogRef, setDialogRef] = createSignal<HTMLDivElement | undefined>();

  const addMutation = useAddEntityPropertyMutation();

  const listPropertiesQuery = useListPropertiesQuery(() => ({
    scope: 'all',
    includeOptions: true,
    forEntityType: entityType,
  }));

  const availableProperties = createMemo((): PropertyDefinitionDomain[] => {
    if (
      listPropertiesQuery.isLoading ||
      listPropertiesQuery.isError ||
      !listPropertiesQuery.data
    ) {
      return [];
    }

    const data = listPropertiesQuery.data;

    const properties = Array.isArray(data) ? data : [];
    return properties.map((item) => {
      if ('definition' in item) {
        return toPropertyDefinitionDomain(
          item.definition,
          item.property_options || []
        );
      }
      return toPropertyDefinitionDomain(item);
    });
  });

  let searchInputRef!: HTMLInputElement;

  const { filteredProperties } = usePropertySelection(
    props.existingPropertyIds,
    availableProperties,
    () => searchQuery()
  );

  const createLabel = createMemo(() => {
    const query = searchQuery().trim();
    return query ? `Create Property "${query}"` : 'Create New Property';
  });

  const createIndex = createMemo(() => filteredProperties().length);

  const addProperty = async (propertyDefinitionId: string) => {
    try {
      await addMutation.mutateAsync({
        entityId: blockId,
        entityType,
        propertyDefinitionId,
      });
      onPropertyAdded([propertyDefinitionId]);
    } catch {
      // Error toast is shown by mutation's onError callback
    } finally {
      props.onClose();
    }
  };

  const handleCreate = () => {
    props.onClose();
    openCreateProperty(true);
  };

  useSearchInputFocus(
    () => searchInputRef,
    () => props.isOpen && availableProperties().length > 0
  );

  createEffect(() => {
    if (props.isOpen) {
      setSearchQuery('');
    }
  });

  createEffect(() => {
    searchQuery();
    setFocusedIndex(0);
  });

  createEffect(() => {
    const index = focusedIndex();
    const elem = document.getElementById(`select-property-option-${index}`);
    if (elem) {
      elem.scrollIntoView({ block: 'nearest' });
    }
  });

  const setKeybindings = useListKeyBindings(dialogRef);

  createEffect(() => {
    const items = filteredProperties();
    const totalLen = items.length + 1; // +1 for Create row
    setKeybindings({
      next: () => setFocusedIndex((prev) => (prev + 1) % totalLen),
      previous: () =>
        setFocusedIndex((prev) => (prev - 1 + totalLen) % totalLen),
      select: () => {
        const idx = focusedIndex();
        if (idx >= items.length) {
          handleCreate();
        } else {
          addProperty(items[idx].id);
        }
      },
    });
  });

  const isFocused = createSelector(focusedIndex);

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      modal={true}
    >
      <Dialog.Portal>
        <DialogWrapper contentRef={setDialogRef}>
          <Panel depth={2} class="flex flex-col text-sm">
            <div class="flex items-center gap-2 bg-panel px-2 h-10 border-b border-edge-muted shrink-0">
              <span class="pl-2 pointer-events-none text-ink-extra-muted">
                ❯
              </span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                placeholder="Add a property..."
                class="flex-1 text-base border-0 outline-none! focus:outline-none ring-0! focus:ring-0 bg-transparent"
                autofocus
              />
            </div>

            <div class="min-h-0 overflow-y-auto scrollbar-hidden">
              <Show
                when={!listPropertiesQuery.isLoading}
                fallback={
                  <div class="flex items-center justify-center py-8">
                    <div class="w-5 h-5 animate-spin">
                      <LoadingSpinner />
                    </div>
                    <span class="ml-2 text-ink-muted">
                      Loading properties...
                    </span>
                  </div>
                }
              >
                <div class="p-1">
                  <For each={filteredProperties()}>
                    {(property, index) => (
                      <button
                        type="button"
                        id={`select-property-option-${index()}`}
                        class={cn(
                          'flex flex-row w-full items-center gap-2 py-1.5 px-2 scroll-my-1',
                          isFocused(index()) && 'bg-active'
                        )}
                        onClick={() => addProperty(property.id)}
                        onMouseEnter={() => setFocusedIndex(index())}
                      >
                        <PropertyDataTypeIcon
                          property={property}
                          class="opacity-50 shrink-0"
                        />
                        <p class="text-sm font-medium truncate text-left grow">
                          {property.displayName}
                        </p>
                        <p class="text-sm text-ink-extra-muted/50 shrink-0">
                          {getPropertyDefinitionTypeDisplay({
                            dataType: property.valueType,
                            specificEntityType: property.specificEntityType,
                            isMultiSelect: property.isMultiSelect,
                          })}
                        </p>
                      </button>
                    )}
                  </For>
                  <button
                    type="button"
                    id={`select-property-option-${createIndex()}`}
                    class={cn(
                      'flex flex-row w-full items-center gap-2 py-1.5 px-2 scroll-my-1',
                      isFocused(createIndex()) && 'bg-hover'
                    )}
                    onClick={handleCreate}
                    onMouseEnter={() => setFocusedIndex(createIndex())}
                  >
                    <PlusIcon class="size-4 shrink-0" />
                    <p class="text-sm font-medium truncate flex-1 text-left">
                      {createLabel()}
                    </p>
                  </button>
                </div>
              </Show>
            </div>
          </Panel>
        </DialogWrapper>
      </Dialog.Portal>
    </Dialog>
  );
}
