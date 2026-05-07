import { useBlockAliasedName, useBlockName } from '@core/block';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import { ResponsiveDropdown } from '@app/component/SimpleDropdown';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { triggerFocusInput } from '@core/directive/focusInput';
import { useIsDocumentOwner } from '@core/signal/permissions';
import ArrowRight from '@icon/regular/arrow-right.svg';
import Copy from '@icon/regular/copy.svg';
import ThreeDots from '@icon/regular/list.svg';
import Rename from '@icon/regular/pencil-line.svg';
import Trash from '@icon/regular/trash-simple.svg';
import { blockNameToItemType, type ItemType } from '@service-storage/client';
import { Button } from '@ui';
import { cn } from '@ui';
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
import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import { toast } from '@core/component/Toast/Toast';
import { buildEntityData } from '@entity';
import { Layer } from '@ui';

export type FileOperationName = 'delete' | 'rename' | 'copy' | 'moveToProject';

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
  tools?: BlockTool[];
  buttonClass?: string;
}) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitFileMenu> must be used in <SplitPanelContext>');

  const isOwner = useIsDocumentOwner();
  const blockName = useBlockName();
  const aliasedBlockName = useBlockAliasedName();
  const itemType = blockNameToItemType(blockName);
  if (!itemType) throw new Error(`Using bad item type for block: ${blockName}`);

  const [open, setOpen] = createSignal(false);
  const itemOperations = useItemOperations();

  const { replaceOrInsertSplit, resetSplit } = useSplitLayout();

  const ops = createMemo<CustomFileOperation[]>(() => {
    return props.ops
      .map((op) => {
        if (isDefaultFileOperation(op)) {
          switch (op.op) {
            case 'delete':
              if (!isOwner()) return null;
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
                  const entity = buildEntityData({
                    id: props.id,
                    name: props.name,
                    blockName: aliasedBlockName,
                  });
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'rename',
                    entities: [entity],
                    onFinish: () => toast.success('Renamed'),
                    onError: () => toast.failure('Failed to rename'),
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
                    replaceOrInsertSplit(
                      {
                        id: res,
                        type: blockName,
                      },
                      'entity-actions-menu'
                    );
                  }
                },
                icon: Copy,
                divideAbove: op.divideAbove || false,
              };

            case 'moveToProject':
              if (!isOwner()) return null;
              return {
                label: 'Move to Folder',
                action: () => {
                  const entity = buildEntityData({
                    id: props.id,
                    name: props.name,
                    blockName: aliasedBlockName,
                  });
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'moveToProject',
                    entities: [entity],
                    onFinish: () => toast.success('Moved to folder'),
                    onError: () => toast.failure('Failed to move to folder'),
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

  const filteredTools = createMemo(() =>
    (props.tools ?? []).filter((t) => !t.condition || t.condition())
  );

  return (
    <ResponsiveDropdown
      open={open()}
      onOpenChange={setOpen}
      boundary={ctx.panelRef}
    >
      <ResponsiveDropdown.Trigger
        as={Button}
        class={cn(
          'px-1',
          open() && 'bg-accent/20 hover:bg-accent/30 text-accent-ink',
          props.buttonClass
        )}
        size="icon-sm"
      >
        <ThreeDots />
      </ResponsiveDropdown.Trigger>
      <ResponsiveDropdown.Portal>
        <Layer depth={2}>
          <ResponsiveDropdown.Content class="bg-menu w-fit p-1 border border-edge-muted rounded-xs shadow">
            <For each={ops()}>
              {(op, i) => (
                <>
                  <Show when={op.divideAbove && i() >= 1}>
                    <div class="my-1 h-px bg-edge-muted" />
                  </Show>
                  <ResponsiveDropdown.Item
                    text={op.label}
                    onClick={() => {
                      op.action();
                      setOpen(false);
                    }}
                    icon={op.icon}
                  />
                </>
              )}
            </For>
            <Show when={filteredTools().length > 0 && ops().length > 0}>
              <div class="my-1 h-px bg-edge-muted" />
            </Show>
            <For each={filteredTools()}>
              {(tool, i) => (
                <>
                  <Show when={tool.divideAbove && i() > 0}>
                    <div class="my-1 h-px bg-edge-muted" />
                  </Show>
                  <ResponsiveDropdown.Item
                    text={
                      typeof tool.label === 'function'
                        ? tool.label()
                        : tool.label
                    }
                    onClick={(e?: MouseEvent) => {
                      tool.action();
                      if (tool.focusTarget) {
                        triggerFocusInput(
                          tool.focusTarget,
                          e?.currentTarget as HTMLElement | undefined
                        );
                      }
                      setOpen(false);
                    }}
                    icon={tool.icon}
                  />
                </>
              )}
            </For>
          </ResponsiveDropdown.Content>
        </Layer>
      </ResponsiveDropdown.Portal>
    </ResponsiveDropdown>
  );
}
