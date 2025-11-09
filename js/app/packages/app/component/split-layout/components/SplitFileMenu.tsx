import { useBlockName } from '@core/block';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { IconButton } from '@core/component/IconButton';
import { MenuItem } from '@core/component/Menu';
import { useIsDocumentOwner } from '@core/signal/permissions';
import Unpin from '@icon/fill/push-pin-slash-fill.svg';
import ArrowRight from '@icon/regular/arrow-right.svg';
import Copy from '@icon/regular/copy.svg';
import ThreeDots from '@icon/regular/list.svg';
import Rename from '@icon/regular/pencil-line.svg';
import Pin from '@icon/regular/push-pin.svg';
import Trash from '@icon/regular/trash-simple.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { blockNameToItemType, type ItemType } from '@service-storage/client';
import { usePinnedIds } from '@service-storage/pins';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  Show,
  useContext,
} from 'solid-js';
import { SplitPanelContext } from '../context';
import { useSplitLayout } from '../layout';
import { useSplitModal } from './SplitModalContext';

export type FileOperationName =
  | 'pin'
  | 'delete'
  | 'rename'
  | 'copy'
  | 'moveToProject';

export type DefaultFileOperation = {
  op: FileOperationName;
  divideAbove?: boolean;
};

export type CustomFileOperation = {
  label: string;
  icon: Component;
  action: () => void;
  divideAbove?: boolean;
};

const isDefaultFileOperation = (
  op: FileOperation
): op is DefaultFileOperation => {
  return 'op' in op;
};

export type FileOperation = DefaultFileOperation | CustomFileOperation;

export function SplitFileMenu(props: {
  id: string;
  itemType: ItemType;
  name: string;
  formattedName?: string;
  ops: Array<FileOperation>;
}) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitFileMenu> must be used in <SplitPanelContext>');

  const isOwner = useIsDocumentOwner();
  const blockName = useBlockName();
  const itemType = blockNameToItemType(blockName);
  if (!itemType) throw new Error(`Using bad item type for block: ${blockName}`);

  const [open, setOpen] = createSignal(false);
  const itemOperations = useItemOperations();

  const pinnedIds = usePinnedIds();
  const isPinned = () => pinnedIds().includes(props.id);

  const modal = useSplitModal();

  const { replaceOrInsertSplit, resetSplit } = useSplitLayout();

  const ops = createMemo<CustomFileOperation[]>(() => {
    return props.ops
      .map((op) => {
        if (isDefaultFileOperation(op)) {
          switch (op.op) {
            case 'pin':
              return {
                label: isPinned() ? 'Unpin' : 'Pin',
                action: () =>
                  itemOperations.togglePin({
                    itemType: props.itemType,
                    id: props.id,
                  }),
                icon: isPinned() ? Unpin : Pin,
                divideAbove: op.divideAbove || false,
              };

            case 'delete':
              return {
                label: 'Delete',
                action: async () => {
                  const res = await itemOperations.deleteItem({
                    itemType: props.itemType,
                    id: props.id,
                    itemName: props.name,
                  });
                  if (res) {
                    resetSplit();
                  }
                },
                icon: Trash,
                divideAbove: op.divideAbove || false,
              };

            case 'rename':
              if (!isOwner()) return null;
              return {
                label: 'Rename',
                action: () => {
                  setOpen(false);
                  modal({
                    id: props.id,
                    name: props.name,
                    itemType: props.itemType,
                    view: 'rename',
                  });
                },
                icon: Rename,
                divideAbove: op.divideAbove || false,
              };

            case 'copy':
              return {
                label: 'Duplicate',
                action: async () => {
                  if (props.itemType === 'project') {
                    console.warn(
                      'Attempting to copy project!. This should not happen'
                    );
                    return;
                  }
                  const res = await itemOperations.copyItem({
                    itemType: props.itemType,
                    id: props.id,
                    name: props.name,
                  });
                  if (res) {
                    replaceOrInsertSplit({
                      id: res,
                      type: blockName,
                    });
                  }
                },
                icon: Copy,
                divideAbove: op.divideAbove || false,
              };

            case 'moveToProject':
              return {
                label: 'Move to Folder',
                action: () => {
                  setOpen(false);
                  modal({
                    id: props.id,
                    name: props.name,
                    itemType: props.itemType,
                    view: 'moveToProject',
                  });
                },
                icon: ArrowRight,
                divideAbove: op.divideAbove || false,
              };
          }
        } else {
          return op;
        }
      })
      .filter((op) => !!op);
  });

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen} boundary={ctx.panelRef}>
      <DropdownMenu.Trigger
        as={IconButton}
        theme={open() ? 'accent' : 'clear'}
        size="sm"
        icon={ThreeDots}
        onclick={() => setOpen((p) => !p)}
        onClick={() => setOpen((p) => !p)}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="bg-menu w-44 p-1 border border-edge mt-2">
          <For each={ops()}>
            {(op, i) => (
              <>
                <Show when={op.divideAbove && i() >= 1}>
                  <div class="my-1 h-[1px] bg-edge" />
                </Show>
                <MenuItem text={op.label} onClick={op.action} icon={op.icon} />
              </>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
