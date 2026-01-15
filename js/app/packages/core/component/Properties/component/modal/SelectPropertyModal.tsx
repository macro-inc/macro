import { useBlockId } from '@core/block';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { MODAL_VIEWPORT_CLASSES } from '@core/util/modalUtils';
import CheckIcon from '@icon/bold/check-bold.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import XIcon from '@icon/regular/x.svg';
import { useAddEntityPropertyMutation } from '@queries/properties/entity';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { MODAL_DIMENSIONS } from '../../constants';
import { usePropertiesContext } from '../../context/PropertiesContext';
import { usePropertySelection } from '../../hooks/usePropertySelection';
import { PROPERTY_STYLES } from '../../styles';
import type {
  PropertyDefinitionDomain,
  PropertySelectorProps,
} from '../../types';
import {
  getPropertyDefinitionTypeDisplay,
  toPropertyDefinitionDomain,
  useSearchInputFocus,
} from '../../utils';
import { useListPropertiesQuery } from '@queries/properties/definitions';

export function SelectPropertyModal(props: PropertySelectorProps) {
  const blockId = useBlockId();
  const { entityType, onPropertyAdded, openCreateProperty } =
    usePropertiesContext();
  const [isAdding, setIsAdding] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');

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
  let modalRef!: HTMLDivElement;

  const { selectedPropertyIds, filteredProperties, togglePropertySelection } =
    usePropertySelection(props.existingPropertyIds, availableProperties, () =>
      searchQuery()
    );

  const handleAddProperties = async () => {
    const selected = selectedPropertyIds();
    if (selected.size === 0) return;

    setIsAdding(true);

    try {
      const addPromises = Array.from(selected).map(
        async (propertyDefinitionId) => {
          try {
            await addMutation.mutateAsync({
              entityId: blockId,
              entityType,
              propertyDefinitionId,
            });
            return true;
          } catch {
            // Error toast is shown by mutation's onError callback
            return false;
          }
        }
      );

      const results = await Promise.all(addPromises);
      const allSucceeded = results.every(Boolean);

      props.onClose();

      if (allSucceeded) {
        onPropertyAdded();
      }
    } finally {
      setIsAdding(false);
    }
  };

  // Always center horizontally but anchor to top for stable positioning
  const modalPosition = () => {
    const viewportHeight = window.innerHeight;
    const topPercentage = MODAL_DIMENSIONS.SELECTOR_TOP_PERCENTAGE;
    const minTopMargin = MODAL_DIMENSIONS.SELECTOR_MIN_TOP_MARGIN;

    const topPosition = Math.max(minTopMargin, viewportHeight * topPercentage);

    const finalTopPosition =
      viewportHeight < MODAL_DIMENSIONS.SELECTOR_SMALL_SCREEN_THRESHOLD
        ? Math.max(
            minTopMargin,
            viewportHeight *
              MODAL_DIMENSIONS.SELECTOR_SMALL_SCREEN_TOP_PERCENTAGE
          )
        : topPosition;

    return {
      top: `${finalTopPosition}px`,
      left: '50%',
      transform: 'translateX(-50%)',
    };
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
    if (!props.isOpen) return;

    const handleResize = () => {
      if (modalRef) {
        const newPosition = modalPosition();
        modalRef.style.top = newPosition.top;
        modalRef.style.left = newPosition.left;
        modalRef.style.transform = newPosition.transform;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  return (
    <Portal>
      <div
        class="fixed inset-0 z-modal-overlay"
        onClick={() => props.onClose()}
        onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
        role="dialog"
        aria-modal="true"
      >
        <div
          ref={modalRef}
          class={`absolute bg-dialog border-3 border-edge shadow-xl w-full overflow-hidden font-mono z-modal-content max-w-md max-h-[80vh] ${MODAL_VIEWPORT_CLASSES}`}
          style={{
            ...modalPosition(),
            'max-width': '28rem',
            'max-height': '80vh',
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="document"
        >
          <div class="flex items-center justify-between p-4">
            <h3 class="text-base font-semibold text-ink">Add Properties</h3>
            <DeprecatedIconButton
              icon={XIcon}
              theme="clear"
              size="sm"
              onClick={() => props.onClose()}
            />
          </div>

          <Show when={availableProperties().length > 0}>
            <div class="px-4 pb-2">
              <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                  <SearchIcon class="h-4 w-4 text-ink-muted" />
                </div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  placeholder="Search properties..."
                  class={`${PROPERTY_STYLES.input.search} relative z-0`}
                />
              </div>
            </div>
          </Show>

          <div class="px-4 pb-2 overflow-y-auto max-h-[60vh]">
            <Show
              when={!listPropertiesQuery.isLoading}
              fallback={
                <div class="flex items-center justify-center py-8">
                  <div class="w-5 h-5 animate-spin">
                    <LoadingSpinner />
                  </div>
                  <span class="ml-2 text-ink-muted">Loading properties...</span>
                </div>
              }
            >
              <Show when={!listPropertiesQuery.error}>
                <Show
                  when={availableProperties().length > 0}
                  fallback={
                    <div class="text-center py-6">
                      <div class="text-ink-muted text-sm">
                        No additional properties available
                      </div>
                    </div>
                  }
                >
                  <div class="space-y-2 max-h-80 overflow-y-auto">
                    <Show
                      when={filteredProperties().length > 0}
                      fallback={
                        <div class="text-center py-4 text-ink-muted text-sm">
                          No properties match your search
                        </div>
                      }
                    >
                      <For each={filteredProperties()}>
                        {(property) => {
                          const isSelected = () =>
                            selectedPropertyIds().has(property.id);

                          return (
                            <button
                              type="button"
                              class={`w-full px-2.5 py-1.5 text-left border ${isSelected() ? 'bg-active border-accent text-accent-ink' : 'hover:bg-hover border-edge text-ink'}`}
                              onClick={() =>
                                togglePropertySelection(property.id)
                              }
                            >
                              <div class="flex items-center justify-between">
                                <div class="flex-1">
                                  <div class="flex items-center gap-2">
                                    <h4 class="font-medium text-xs">
                                      {property.displayName}
                                    </h4>
                                  </div>
                                  <div class="text-xs text-ink-muted mt-0.5">
                                    {getPropertyDefinitionTypeDisplay({
                                      dataType: property.valueType,
                                      specificEntityType:
                                        property.specificEntityType,
                                      isMultiSelect: property.isMultiSelect,
                                    })}
                                  </div>
                                </div>
                                <div
                                  class={`${PROPERTY_STYLES.checkbox.base} border-edge bg-transparent`}
                                >
                                  <Show when={isSelected()}>
                                    <CheckIcon class="w-3 h-3 text-accent" />
                                  </Show>
                                </div>
                              </div>
                            </button>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>

          <div class="flex items-center justify-between p-4 pt-2">
            <button
              type="button"
              class={`${PROPERTY_STYLES.button.base} ${PROPERTY_STYLES.button.secondary}`}
              onClick={() => props.onClose()}
              disabled={isAdding()}
            >
              Cancel
            </button>
            <Show when={selectedPropertyIds().size > 0}>
              <button
                type="button"
                class={`${PROPERTY_STYLES.button.base} ${selectedPropertyIds().size > 0 && !isAdding() ? PROPERTY_STYLES.button.accent : 'bg-ink-muted text-ink cursor-not-allowed'}`}
                onClick={handleAddProperties}
                disabled={selectedPropertyIds().size === 0 || isAdding()}
              >
                <Show
                  when={!isAdding()}
                  fallback={
                    <div class="flex items-center gap-1.5">
                      <div class="w-3 h-3 animate-spin">
                        <LoadingSpinner />
                      </div>
                      Adding...
                    </div>
                  }
                >
                  Add{' '}
                  {selectedPropertyIds().size > 0
                    ? `(${selectedPropertyIds().size})`
                    : ''}
                </Show>
              </button>
            </Show>
            <Show when={selectedPropertyIds().size === 0}>
              <div class="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    props.onClose();
                    openCreateProperty();
                  }}
                  class={`${PROPERTY_STYLES.button.base} ${PROPERTY_STYLES.button.accent}`}
                  disabled={false}
                >
                  Create New Property
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
