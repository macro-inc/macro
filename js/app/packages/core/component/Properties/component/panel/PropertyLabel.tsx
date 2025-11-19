import { IconButton } from '@core/component/IconButton';
import DeleteIcon from '@icon/bold/x-bold.svg';
import PinIcon from '@icon/regular/push-pin.svg';
import UnpinIcon from '@icon/regular/push-pin-slash.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { type Component, createMemo, createSignal, Show } from 'solid-js';
import { deleteEntityProperty } from '../../api';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';

type PropertyLabelProps = {
  property: Property;
};

export const PropertyLabel: Component<PropertyLabelProps> = (props) => {
  const {
    canEdit,
    documentName,
    onPropertyDeleted,
    onPropertyPinned,
    onPropertyUnpinned,
    pinnedPropertyIds,
  } = usePropertiesContext();

  const isPinned = createMemo(
    () => pinnedPropertyIds?.()?.includes(props.property.propertyId) ?? false
  );
  const [isHovered, setIsHovered] = createSignal(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);

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
    setIsDeleting(true);
    const result = await deleteEntityProperty(props.property.propertyId);

    if (result.ok) {
      setDeleteConfirmVisible(false);
      onPropertyDeleted();
    }

    setIsDeleting(false);
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmVisible(false);
  };

  return (
    <>
      <div
        class="flex items-center min-w-0"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span class="text-sm pr-2 text-ink-muted truncate flex-shrink min-w-0">
          {props.property.displayName}
        </span>
        {/* Always reserve space for delete button to prevent layout shift */}
        <Show
          when={canEdit && !props.property.isMetadata}
          fallback={<div class="w-3 h-3 flex-shrink-0" />}
        >
          <Show when={onPropertyPinned && onPropertyUnpinned}>
            <div
              class={`flex-shrink-0 transition-opacity ${
                isHovered() ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <IconButton
                icon={isPinned() ? UnpinIcon : PinIcon}
                theme="clear"
                size="xs"
                tooltip={{
                  label: isPinned() ? 'Unpin property' : 'Pin property',
                }}
                onClick={handlePinClick}
              />
            </div>
          </Show>

          <div
            class={`flex-shrink-0 transition-opacity ${
              isHovered() ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <IconButton
              icon={DeleteIcon}
              theme="clear"
              size="xs"
              class="!text-failure hover:!bg-failure/15"
              tooltip={{ label: 'Remove property' }}
              onClick={handleDeleteClick}
            />
          </div>
        </Show>
      </div>

      <Dialog
        open={deleteConfirmVisible()}
        onOpenChange={setDeleteConfirmVisible}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-modal-overlay bg-overlay" />
          <div class="fixed inset-0 z-modal-content flex items-center justify-center p-4">
            <Dialog.Content class="bg-dialog border-3 border-edge shadow-xl max-w-md w-full font-mono">
              <div class="flex items-center justify-between p-4">
                <Dialog.Title class="text-lg font-semibold text-ink">
                  Delete Property
                </Dialog.Title>
                <IconButton
                  icon={XIcon}
                  theme="clear"
                  size="sm"
                  onClick={handleDeleteCancel}
                  disabled={isDeleting()}
                />
              </div>
              <div class="px-4 pb-4">
                <Dialog.Description class="text-sm text-ink-muted mb-4">
                  Are you sure you want to remove property "
                  {props.property.displayName}"
                  {documentName ? ` from "${documentName}"` : ''}?
                </Dialog.Description>
                <div class="flex justify-end gap-2">
                  <button
                    onClick={handleDeleteCancel}
                    disabled={isDeleting()}
                    class="px-3 py-1.5 text-sm border text-ink-muted hover:text-ink border-edge hover:bg-hover"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={isDeleting()}
                    class="px-3 py-1.5 text-sm border bg-failure/90 hover:bg-failure/80 text-ink disabled:opacity-50"
                  >
                    {isDeleting() ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </>
  );
};
