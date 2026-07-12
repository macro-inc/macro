import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { makeFavoriteAction } from '@app/features/next-soup/actions';
import { useBlockAliasedName, useBlockName } from '@core/block';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { toast } from '@core/component/Toast/Toast';
import { useQuickAccess } from '@core/context/quickAccess';
import { triggerFocusInput } from '@core/directive/focusInput';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { buildEntityData, type EntityData } from '@entity';
import DotsThree from '@icon/dots-three-large.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Copy from '@phosphor/copy.svg';
import Rename from '@phosphor/pencil-line.svg';
import Star from '@phosphor/star.svg';
import Trash from '@phosphor/trash-simple.svg';
import { blockNameToItemType, type ItemType } from '@service-storage/client';
import { cn, Dropdown } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  getSplitFileMenuActionSections,
  type SplitFileMenuAction,
  SplitPanelContext,
} from '../context';
import { useSplitLayout } from '../layout';

export type FileOperationName = 'delete' | 'rename' | 'copy' | 'moveToProject';

export type DefaultFileOperation = {
  op: FileOperationName;
};

export type CustomFileOperation = {
  label: string;
  icon: Component;
  action?: () => void;
  children?: SplitFileMenuAction[];
};

const isDefaultFileOperation = (
  op: FileOperation
): op is DefaultFileOperation => {
  return 'op' in op;
};

export type FileOperation = DefaultFileOperation | CustomFileOperation;

function SplitMenuItemContent(
  props: Pick<SplitFileMenuAction, 'icon' | 'label'>
) {
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
  ops: SplitFileMenuAction[];
  tools: SplitFileMenuAction[];
};

function DesktopRender(props: SplitFileMenuRenderProps) {
  const sections = () =>
    getSplitFileMenuActionSections({
      tools: props.tools,
      primaryOps: props.ops.filter((op) => op.group !== 'delete'),
      deleteOps: props.ops.filter((op) => op.group === 'delete'),
    });

  const item = (action: SplitFileMenuAction) => {
    const children = () => action.children?.filter(Boolean) ?? [];

    return (
      <Show
        when={children().length > 0}
        fallback={
          <Dropdown.Item
            onSelect={() => {
              action.action?.();
              props.onOpenChange(false);
            }}
          >
            <SplitMenuItemContent icon={action.icon} label={action.label} />
          </Dropdown.Item>
        }
      >
        <Dropdown.Sub>
          <Dropdown.SubTrigger>
            <SplitMenuItemContent icon={action.icon} label={action.label} />
            <CaretRight class="size-3.5 shrink-0" />
          </Dropdown.SubTrigger>
          <Dropdown.SubContent>
            <Dropdown.Group>
              <For each={children()}>{item}</For>
            </Dropdown.Group>
          </Dropdown.SubContent>
        </Dropdown.Sub>
      </Show>
    );
  };

  return (
    <Dropdown open={props.open} onOpenChange={props.onOpenChange}>
      <Dropdown.Trigger
        class={cn(props.triggerClass)}
        size="icon-sm"
        variant="ghost"
      >
        <DotsThree />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-fit shadow-menu">
        <For each={sections()}>
          {(section) => (
            <Dropdown.Group>
              <For each={section.actions}>{item}</For>
            </Dropdown.Group>
          )}
        </For>
      </Dropdown.Content>
    </Dropdown>
  );
}

function MobileRender(props: SplitFileMenuRenderProps) {
  const [expandedSubmenu, setExpandedSubmenu] =
    createSignal<SplitFileMenuAction>();

  const item = (action: SplitFileMenuAction, nested = false) => {
    const children = () => action.children?.filter(Boolean) ?? [];
    const expanded = () => expandedSubmenu() === action;

    return (
      <Show
        when={children().length > 0}
        fallback={
          <button
            type="button"
            class={cn(
              'w-full bg-surface flex items-center gap-3 py-3 text-sm hover:bg-hover hover-transition-bg text-left not-last:mb-px text-ink',
              nested ? 'pl-9 pr-4' : 'px-4'
            )}
            onClick={(e) => {
              action.action?.(e);
              props.onOpenChange(false);
            }}
          >
            <SplitMenuItemContent icon={action.icon} label={action.label} />
          </button>
        }
      >
        <div class="w-full bg-surface">
          <button
            type="button"
            class={cn(
              'w-full flex items-center gap-3 py-3 text-sm hover:bg-hover hover-transition-bg text-left text-ink',
              nested ? 'pl-9 pr-4' : 'px-4'
            )}
            onClick={() => {
              setExpandedSubmenu(expanded() ? undefined : action);
            }}
          >
            <SplitMenuItemContent icon={action.icon} label={action.label} />
            <Dynamic
              component={expanded() ? CaretDown : CaretRight}
              class="size-3.5 shrink-0"
            />
          </button>
          <Show when={expanded()}>
            <div class="border-t border-edge-muted/60">
              <For each={children()}>{(child) => item(child, true)}</For>
            </div>
          </Show>
        </div>
      </Show>
    );
  };

  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="File actions">
          <MobileDrawer.Handle />
          <Show when={props.tools.length > 0}>
            <MobileDrawer.Section class="flex flex-col shrink-0">
              <For each={props.tools}>{(action) => item(action)}</For>
            </MobileDrawer.Section>
          </Show>
          <Show when={props.ops.length > 0}>
            <Show when={props.tools.length > 0}>
              <div class="mt-3" />
            </Show>
            <MobileDrawer.Section class="flex flex-col shrink-0">
              <For each={props.ops}>{(action) => item(action)}</For>
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
  const quickAccess = useQuickAccess();
  const favoriteAction = makeFavoriteAction();

  const { replaceOrInsertSplit, resetSplit } = useSplitLayout();

  // The entity this menu operates on: prefer the quick-access cache (richer
  // data, covers channels/calls), fall back to building it from the block's
  // id/name/blockName like the rename/move ops do.
  const menuEntity = createMemo<EntityData | undefined>(() => {
    const item = quickAccess.getById(props.id);
    if (item?.kind === 'entity') return item.data;
    return buildEntityData({
      id: props.id,
      name: props.name,
      blockName: aliasedBlockName,
    });
  });

  const favoriteOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !favoriteAction.canExecute(entity)) return undefined;
    return {
      label: favoriteAction.isFavorited(entity) ? 'Unfavorite' : 'Favorite',
      icon: Star,
      action: () => {
        void favoriteAction.execute([entity]);
      },
    };
  };

  createEffect(() => {
    const openMenu = () => setOpen(true);
    ctx.setTitleFileMenuTrigger(() => openMenu);
    onCleanup(() => ctx.setTitleFileMenuTrigger(undefined));
  });

  const ops = createMemo<SplitFileMenuAction[]>(() => {
    const favorite = favoriteOp();
    const mapped = props.ops
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
                group: 'delete' as const,
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
    return favorite ? [favorite, ...mapped] : mapped;
  });

  const filteredTools = createMemo(() =>
    (props.tools ?? []).filter((t) => !t.condition || t.condition())
  );

  const tools = createMemo<SplitFileMenuAction[]>(() =>
    filteredTools().map((tool) => ({
      label: typeof tool.label === 'function' ? tool.label() : tool.label,
      icon: tool.icon,
      children: tool.children,
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

  const actionGroups = createMemo(() => ({
    tools: tools(),
    primaryOps: ops().filter((op) => op.group !== 'delete'),
    deleteOps: ops().filter((op) => op.group === 'delete'),
  }));

  createEffect(() => {
    ctx.setTitleFileMenuActions(actionGroups());
  });

  onCleanup(() => ctx.setTitleFileMenuActions(undefined));

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
