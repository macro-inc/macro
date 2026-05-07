import { useSplitLayout } from '@app/component/split-layout/layout';
import { cn } from '@ui';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import type { BlockAlias, BlockName } from '@core/block';
import { EntityIcon, getIconConfig } from '@core/component/EntityIcon';
import { Button } from '@ui';
import { toast } from '@core/component/Toast/Toast';
import { pressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import {
  createCanvasFileFromJsonString,
  createChat,
  createMarkdownFile,
  createTask,
} from '@core/util/create';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Layer } from '@ui';
import PlusIcon from '@icon/regular/plus.svg';
import { createProject } from '@queries/storage/projects';
import { type Component, createSignal, For } from 'solid-js';
import { Dialog, Surface } from '@ui';

type MenuItemProps = {
  label: string;
  blockName: BlockName | BlockAlias;
  index?: number;
  hotkeyToken: HotkeyToken;
  Icon: Component;
  action: () => void | Promise<void>;
};

type CreateBlockSpec = {
  label: string;
  blockName: BlockName | BlockAlias;
  hotkeyToken: HotkeyToken;
  icon: Component;
  loading?: boolean;
  createFn: (projectId: string) => Promise<string>;
};

const BLOCK_CREATE_SPECS: CreateBlockSpec[] = [
  {
    label: 'Note',
    blockName: 'md' as BlockName,
    hotkeyToken: TOKENS.create.note,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="md" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const result = await createMarkdownFile({
        title: '',
        content: '',
        projectId,
      });
      if (!result) throw new Error('Failed to create markdown file');
      return result;
    },
  },
  {
    label: 'Task',
    blockName: 'task' as BlockAlias,
    hotkeyToken: TOKENS.create.task,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="task" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const result = await createTask({
        title: '',
        content: '',
        projectId,
        propertyValues: [
          {
            propertyId: SYSTEM_PROPERTY_IDS.STATUS,
            value: {
              type: 'select_option',
              option_id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
            },
          },
        ],
      });
      if (!result) throw new Error('Failed to create task');
      return result;
    },
  },
  {
    label: 'AI',
    blockName: 'chat' as BlockName,
    hotkeyToken: TOKENS.create.chat,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="chat" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    createFn: async (projectId) => {
      const result = await createChat({ projectId });
      if ('error' in result) {
        console.error(result.error);
        throw new Error('Failed to create chat');
      }
      return result.chatId;
    },
  },
  {
    label: 'Canvas',
    blockName: 'canvas' as BlockName,
    hotkeyToken: TOKENS.create.canvas,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="canvas" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const result = await createCanvasFileFromJsonString({
        json: JSON.stringify({ nodes: [], edges: [] }),
        title: 'New Canvas',
        projectId,
      });
      if ('error' in result) {
        console.error(result.error);
        throw new Error('Failed to create canvas');
      }
      return result.documentId;
    },
  },
  {
    label: 'Folder',
    blockName: 'project' as BlockName,
    hotkeyToken: TOKENS.create.project,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="project" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    createFn: async (projectId) => {
      const result = await createProject({
        name: 'New Project',
        parentId: projectId,
      });
      if (!result) throw new Error('Failed to create folder');
      return result;
    },
  },
];

function makeCreateBlock({
  replaceSplit,
  insertSplit,
}: Pick<ReturnType<typeof useSplitLayout>, 'replaceSplit' | 'insertSplit'>) {
  return async (spec: {
    blockName: BlockName | BlockAlias;
    createFn: () => Promise<string>;
    loading?: boolean;
  }) => {
    const { blockName, createFn, loading } = spec;

    const shouldInsert = pressedKeys().has('shift');

    const tryCreate = async () => {
      try {
        const id = await createFn();
        return id;
      } catch (e) {
        toast.failure(e.message);
        return null;
      }
    };

    if (!loading) {
      const id = await tryCreate();
      if (!id) return;

      const block = { type: blockName, id };

      shouldInsert
        ? insertSplit(block, 'entity-actions-menu')
        : replaceSplit({ content: block, referredFrom: 'entity-actions-menu' });
    } else {
      const split = shouldInsert
        ? insertSplit(
            { type: 'component', id: 'loading' },
            'entity-actions-menu'
          )
        : replaceSplit({
            content: { type: 'component', id: 'loading' },
            referredFrom: 'entity-actions-menu',
          });

      const id = await tryCreate();
      if (!id) {
        split?.goBack();
        return;
      }

      if (split)
        split.replace({
          next: { type: blockName, id },
          mergeHistory: true,
          referredFrom: 'entity-actions-menu',
        });
    }
  };
}

function ProjectCreateDialog(props: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  name: string;
}) {
  const { replaceSplit, insertSplit } = useSplitLayout();
  const createBlock = makeCreateBlock({ replaceSplit, insertSplit });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <Surface depth={2} active>
        <div class="*:max-h-[75vh]">
          <div class="p-2">
            <Dialog.Title class="text-md font-semibold text-ink pb-3">
              Create in {props.name}
            </Dialog.Title>
            <For each={BLOCK_CREATE_SPECS}>
              {(spec) => (
                <button
                  class="flex items-center gap-2 py-1 text-sm hover:bg-hover w-full text-left min-h-11"
                  onClick={() => {
                    props.onClose();
                    createBlock({
                      blockName: spec.blockName,
                      loading: spec.loading,
                      createFn: () => spec.createFn(props.projectId),
                    });
                  }}
                >
                  <div class="size-4 shrink-0">
                    <spec.icon />
                  </div>
                  {spec.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}

function MenuItem(props: MenuItemProps) {
  const selectedColor = getIconConfig(props.blockName).foreground;

  return (
    <DropdownMenu.Item
      class={cn(
        'flex justify-between items-center gap-12 px-1.5 py-1 text-sm isolate transition-transform ease-click duration-200 text-ink-extra-muted outline-none data-highlighted:bg-active',
        `data-highlighted:${selectedColor}`
      )}
      onSelect={props.action}
    >
      <div class="flex items-center gap-1">
        <div class="size-4">
          <props.Icon />
        </div>
        <span>{props.label}</span>
      </div>
    </DropdownMenu.Item>
  );
}

function MenuContent(props: { projectId: string }) {
  const { replaceSplit, insertSplit } = useSplitLayout();
  const createBlock = makeCreateBlock({ replaceSplit, insertSplit });

  const items: MenuItemProps[] = BLOCK_CREATE_SPECS.map((spec) => ({
    label: spec.label,
    blockName: spec.blockName,
    hotkeyToken: spec.hotkeyToken,
    Icon: spec.icon,
    action: () =>
      createBlock({
        blockName: spec.blockName,
        loading: spec.loading,
        createFn: () => spec.createFn(props.projectId),
      }),
  }));

  return (
    <DropdownMenu.Content class="isolate relative flex flex-col gap-2 bg-dialog -mb-1 p-2 border-2 border-accent min-w-max">
      <For each={items}>
        {(item, index) => <MenuItem {...item} index={index() + 1} />}
      </For>
    </DropdownMenu.Content>
  );
}

export function useProjectCreateTools(
  projectId: string,
  name: () => string,
  condition?: () => boolean
): { tools: BlockTool[]; CreateDialog: Component } {
  const [open, setOpen] = createSignal(false);

  const tools: BlockTool[] = [
    {
      label: 'Create',
      icon: PlusIcon,
      // Using a setTimeout here so that the synthetic click event after the touch doesn't instantly select an item
      action: () => setTimeout(() => setOpen(true), 0),
      divideAbove: true,
      condition,
    },
  ];

  const CreateDialog: Component = () => (
    <ProjectCreateDialog
      open={open()}
      onClose={() => setOpen(false)}
      projectId={projectId}
      name={name()}
    />
  );

  return { tools, CreateDialog };
}

export function ProjectCreateMenu(props: { id: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <DropdownMenu open={open()} onOpenChange={setOpen}>
      <div class="flex items-center">
        <DropdownMenu.Trigger class="h-min">
          <Button size="sm" variant={open() ? 'active' : 'base'}>
            Create
          </Button>
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <Layer depth={2}>
          <MenuContent projectId={props.id} />
        </Layer>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
