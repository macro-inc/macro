import {
  EntityModalActionFooter,
  EntityModalTitle,
} from '@app/component/EntityModal/EntityModal';
import { getSplitPanelRef } from '@app/component/split-layout/layoutUtils';
import clickOutside from '@core/directive/clickOutside';
import { Dialog } from '@kobalte/core/dialog';
import {
  type Accessor,
  createSignal,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';

false && clickOutside;

export function AutomationRenameModal(props: {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  name: string;
  onRename: (newName: string) => void;
}) {
  return (
    <Show when={props.isOpen()}>
      <AutomationRenameModalContent
        isOpen={props.isOpen}
        setIsOpen={props.setIsOpen}
        name={props.name}
        onRename={props.onRename}
      />
    </Show>
  );
}

function AutomationRenameModalContent(props: {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  name: string;
  onRename: (newName: string) => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  const [editValue, setEditValue] = createSignal(props.name);

  const close = () => props.setIsOpen(false);

  const finishEditing = () => {
    const newValue = editValue().trim();
    if (newValue) {
      props.onRename(newValue);
    }
    close();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <Dialog open={props.isOpen()} onOpenChange={props.setIsOpen} modal={true}>
      <Portal mount={getSplitPanelRef() ?? undefined}>
        <Dialog.Overlay
          as="div"
          class="absolute z-modal inset-px bg-modal-overlay"
          use:clickOutside={close}
          on:click={close}
        />
        <div class="absolute z-modal pointer-events-none px-2 inset-px">
          <Dialog.Content class="pointer-events-none!">
            <div class="pointer-events-auto w-full max-w-[min(36rem,calc(100%-1rem))] mx-auto mt-16 bg-surface border border-edge h-fit p-2">
              <div class="w-full my-1">
                <EntityModalTitle title="Rename" />
                <div class="w-full">
                  <input
                    ref={(el) => {
                      inputRef = el;
                      onMount(() => {
                        setTimeout(() => {
                          inputRef?.focus();
                          inputRef?.select();
                        });
                      });
                    }}
                    value={editValue()}
                    onInput={(e) => setEditValue(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    class="w-full p-2 text-sm border border-edge bg-surface text-ink placeholder:text-ink-placeholder focus:outline-none focus:bg-active selection:bg-ink selection:text-surface"
                    placeholder="Enter title..."
                  />
                </div>
                <EntityModalActionFooter
                  onCancel={close}
                  onConfirm={finishEditing}
                  confirmText="Rename"
                />
              </div>
            </div>
          </Dialog.Content>
        </div>
      </Portal>
    </Dialog>
  );
}
