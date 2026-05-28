import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import { useBlockAliasedName, useBlockName } from '@core/block';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { toast } from '@core/component/Toast/Toast';
import { triggerFocusInput } from '@core/directive/focusInput';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { buildEntityData } from '@entity';
import ArrowRight from '@phosphor/arrow-right.svg';
import Copy from '@phosphor/copy.svg';
import ThreeDots from '@phosphor/list.svg';
import Rename from '@phosphor/pencil-line.svg';
import Trash from '@phosphor/trash-simple.svg';
import { blockNameToItemType, type ItemType } from '@service-storage/client';
import { Button, Dropdown } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SplitPanelContext } from '../context';
import { useSplitLayout } from '../layout';

export type FileOperationName = 'delete' | 'rename' | 'copy' | 'moveToProject';

export type DefaultFileOperation = {
  op: FileOperationName;
};

export type CustomFileOperation = {
  label: string;
  icon: Component;
  action: () => void;
};

const isDefaultFileOperation = (
  op: FileOperation
): op is DefaultFileOperation => {
  return 'op' in op;
};

export type FileOperation = DefaultFileOperation | CustomFileOperation;

type SplitMenuAction = {
  label: string | JSX.Element;
  icon: Component;
  action: (e?: MouseEvent) => void;
  group?: 'delete';
};

function SplitMenuItemContent(props: Pick<SplitMenuAction, 'icon' | 'label'>) {
  return (
    <>
      <Dynamic
        component={props.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
        class="size-4 shrink-0"
      />
      <div class="flex-1 truncate">{props.label}</div>
    </>
  );
}

type SplitFileMenuRenderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerClass?: string;
  ops: SplitMenuAction[];
  tools: SplitMenuAction[];
};

function DesktopRender(props: SplitFileMenuRenderProps) {
  const primaryOps = () => props.ops.filter((op) => op.group !== 'delete');
  const deleteOps = () => props.ops.filter((op) => op.group === 'delete');

  const item = (action: SplitMenuAction) => (
    <Dropdown.Item
      onSelect={() => {
        action.action();
        props.onOpenChange(false);
      }}
    >
      <SplitMenuItemContent icon={action.icon} label={action.label} />
    </Dropdown.Item>
  );

  return (
    <Dropdown open={props.open} onOpenChange={props.onOpenChange}>
      <Dropdown.Trigger
        class={props.triggerClass}
        size="icon-sm"
        variant="ghost"
      >
        <ThreeDots />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-fit">
        <Show when={primaryOps().length > 0}>
          <Dropdown.Group>
            <For each={primaryOps()}>{item}</For>
          </Dropdown.Group>
        </Show>
        <Show when={props.tools.length > 0}>
          <Dropdown.Group>
            <For each={props.tools}>{item}</For>
          </Dropdown.Group>
        </Show>
        <Show when={deleteOps().length > 0}>
          <Dropdown.Group>
            <For each={deleteOps()}>{item}</For>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}

function MobileRender(props: SplitFileMenuRenderProps) {
  const item = (action: SplitMenuAction) => (
    <button
      type="button"
      class="w-full bg-surface flex items-center gap-3 px-4 py-3 text-sm hover:bg-hover hover-transition-bg text-left not-last:mb-px text-ink"
      onClick={(e) => {
        action.action(e);
        props.onOpenChange(false);
      }}
    >
      <SplitMenuItemContent icon={action.icon} label={action.label} />
    </button>
  );

  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Trigger
        as={Button}
        class={props.triggerClass}
        size="icon-sm"
        variant="ghost"
      >
        <ThreeDots />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="File actions">
          <MobileDrawer.Handle />
          <Show when={props.ops.length > 0}>
            <MobileDrawer.Section class="flex flex-col shrink-0">
              <For each={props.ops}>{item}</For>
            </MobileDrawer.Section>
          </Show>
          <Show when={props.tools.length > 0}>
            <Show when={props.ops.length > 0}>
              <div class="mt-3" />
            </Show>
            <MobileDrawer.Section class="flex flex-col shrink-0">
              <For each={props.tools}>{item}</For>
            </MobileDrawer.Section>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

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
                group: 'delete',
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

  const tools = createMemo<SplitMenuAction[]>(() =>
    filteredTools().map((tool) => ({
      label: typeof tool.label === 'function' ? tool.label() : tool.label,
      icon: tool.icon,
      action: (e?: MouseEvent) => {
        tool.action();
        if (tool.focusTarget) {
          triggerFocusInput(
            tool.focusTarget,
            e?.currentTarget as HTMLElement | undefined
          );
        }
        setOpen(false);
      },
    }))
  );

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <DesktopRender
          open={open()}
          onOpenChange={setOpen}
          triggerClass={props.buttonClass}
          ops={ops()}
          tools={tools()}
        />
      }
    >
      <MobileRender
        open={open()}
        onOpenChange={setOpen}
        triggerClass={props.buttonClass}
        ops={ops()}
        tools={tools()}
      />
    </Show>
  );
}
