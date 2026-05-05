import { useMaybeBlockAliasedName, useMaybeBlockId } from '@core/block';
import { cn } from '@ui/utils/classname';
import { Button } from '@ui/components/Button';
import { DialogWrapper } from '@core/component/DialogWrapper';
import DeleteIcon from '@icon/bold/x-bold.svg';
import PinIcon from '@icon/regular/push-pin.svg';
import UnpinIcon from '@icon/regular/push-pin-slash.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { useDeleteEntityPropertyMutation } from '@queries/properties/entity';
import { type Component, createMemo, createSignal, Show } from 'solid-js';
import {
  getBuiltinPropertyIds,
  getDefaultPinnedProperties,
} from '../../constants';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { PropertyDataTypeIcon } from '../../utils';

type PropertyLabelProps = {
  property: Property;
  withPin?: boolean;
  withDelete?: boolean;
};

export const PropertyLabel: Component<PropertyLabelProps> = (props) => {
  const {
    canEdit,
    documentName,
    entityType,
    onPropertyDeleted,
    onPropertyPinned,
    onPropertyUnpinned,
    pinnedPropertyIds,
  } = usePropertiesContext();
  const maybeBlockId = useMaybeBlockId();
  const blockName = useMaybeBlockAliasedName();
  const isBuiltin =
    blockName &&
    getBuiltinPropertyIds(blockName).includes(
      props.property.propertyDefinitionId
    );
  const isDefaultPinned =
    blockName &&
    getDefaultPinnedProperties(blockName).includes(
      props.property.propertyDefinitionId
    );

  const deleteMutation = useDeleteEntityPropertyMutation();

  const isPinned = createMemo(
    () => pinnedPropertyIds?.()?.includes(props.property.propertyId) ?? false
  );
  const [isHovered, setIsHovered] = createSignal(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = createSignal(false);

  const handlePinClick = () => {
    if (isPinned()) {
      onPropertyUnpinned?.(props.property.propertyId);
    } else {
      onPropertyPinned?.(props.property.propertyId);
    }
  };

  const handleDeleteClick = () => {
    setDeleteConfirmVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!maybeBlockId) return;
    try {
      await deleteMutation.mutateAsync({
        entityPropertyId: props.property.propertyId,
        entityType,
        entityId: maybeBlockId,
      });
      setDeleteConfirmVisible(false);
      onPropertyDeleted();
    } catch {
      // Error toast is shown by the mutation's onError callback
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmVisible(false);
  };

  return (
    <>
      <div
        class="flex items-center gap-1.5 min-w-0 py-0.5"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <PropertyDataTypeIcon
          property={props.property}
          class="size-4 shrink-0 opacity-40"
        />
        <span class="truncate shrink min-w-0">
          {props.property.displayName}
        </span>
        {/* Always reserve space for delete button to prevent layout shift */}
        <Show
          when={canEdit && !props.property.isMetadata}
          fallback={<div class="w-3 h-3 shrink-0" />}
        >
          <Show
            when={
              onPropertyPinned &&
              onPropertyUnpinned &&
              !isDefaultPinned &&
              props.withPin
            }
          >
            <div
              class={cn(
                'shrink-0 transition-opacity',
                isHovered() ? 'opacity-100' : 'opacity-0'
              )}
            >
              <Button
                variant="ghost"
                class="p-1"
                tooltip={isPinned() ? 'Unpin property' : 'Pin property'}
                onClick={handlePinClick}
              >
                {isPinned() ? (
                  <UnpinIcon class="size-3" />
                ) : (
                  <PinIcon class="size-3" />
                )}
              </Button>
            </div>
          </Show>

          <Show when={!isBuiltin && props.withDelete}>
            <div
              class={cn(
                'shrink-0 transition-opacity',
                isHovered() ? 'opacity-100' : 'opacity-0'
              )}
            >
              <Button
                variant="ghost"
                class="p-1 text-failure! hover:bg-failure/15!"
                tooltip="Remove property"
                onClick={handleDeleteClick}
              >
                <DeleteIcon class="size-3" />
              </Button>
            </div>
          </Show>
        </Show>
      </div>

      <Dialog
        open={deleteConfirmVisible()}
        onOpenChange={setDeleteConfirmVisible}
      >
        <Dialog.Portal>
          <DialogWrapper>
            <div class="flex flex-col overflow-hidden text-sm">
              <div class="flex items-center justify-between gap-2 bg-panel px-2 h-10 border-b border-edge-muted shrink-0">
                <Dialog.Title class="pl-2 text-sm font-medium">
                  Delete Property
                </Dialog.Title>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleDeleteCancel}
                  disabled={deleteMutation.isPending}
                >
                  <XIcon />
                </Button>
              </div>
              <div class="p-4">
                <Dialog.Description class="text-sm text-ink-muted">
                  Are you sure you want to remove property "
                  {props.property.displayName}"
                  {documentName ? ` from "${documentName}"` : ''}?
                </Dialog.Description>
              </div>
              <div class="flex items-center justify-end gap-2 px-2 py-1.5 border-t border-edge-muted shrink-0">
                <Button
                  variant="ghost"
                  onClick={handleDeleteCancel}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteConfirm}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>
    </>
  );
};
