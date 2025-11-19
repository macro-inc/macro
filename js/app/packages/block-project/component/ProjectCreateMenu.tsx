import { useSplitLayout } from '@app/component/split-layout/layout';
import type { BlockName } from '@core/block';
import { EntityIcon, getIconConfig } from '@core/component/EntityIcon';
import { Button } from '@core/component/FormControls/Button';
import { toast } from '@core/component/Toast/Toast';
import { pressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import {
  createCanvasFileFromJsonString,
  createChat,
  createMarkdownFile,
} from '@core/util/create';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { useCreateProject } from '@service-storage/projects';
import { type Component, createSignal, For } from 'solid-js';

type MenuItemProps = {
  label: string;
  blockName: BlockName;
  index?: number;
  hotkeyToken: HotkeyToken;
  Icon: Component;
  action: () => void | Promise<void>;
};

function MenuItem(props: MenuItemProps) {
  const selectedColor = getIconConfig(props.blockName ?? 'pdf').foreground;

  return (
    <DropdownMenu.Item
      class={`flex justify-between items-center gap-12 px-1.5 py-1 text-sm isolate transition-transform ease-click duration-200 text-ink-extra-muted data-highlighted:${selectedColor} data-highlighted:bracket-offset-4`}
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
  let ref!: HTMLDivElement;

  const createBlock = async (spec: {
    blockName: BlockName;
    createFn: () => Promise<string>;
    loading?: boolean;
  }) => {
    const { blockName, createFn, loading } = spec;

    const shouldInsert = pressedKeys().has('opt');

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

      shouldInsert ? insertSplit(block) : replaceSplit(block);
    } else {
      const split = shouldInsert
        ? insertSplit({ type: 'component', id: 'loading' })
        : replaceSplit({ type: 'component', id: 'loading' });

      const id = await tryCreate();
      if (!id) {
        split?.goBack();
        return;
      }

      if (split) split.replace({ type: blockName, id }, true);
    }
  };

  const CREATABLE_BLOCKS: MenuItemProps[] = [
    {
      label: 'Note',
      blockName: 'md' as BlockName,
      hotkeyToken: TOKENS.global.create.note,
      Icon: () => (
        <EntityIcon targetType="md" size="shrinkFill" theme="monochrome" />
      ),
      action: () =>
        createBlock({
          blockName: 'md',
          loading: true,
          createFn: async () => {
            const result = await createMarkdownFile({
              title: '',
              content: '',
              projectId: props.projectId,
            });
            if (!result) throw new Error('Failed to create markdown file');
            return result;
          },
        }),
    },
    {
      label: 'AI',
      blockName: 'chat' as BlockName,
      hotkeyToken: TOKENS.global.create.chat,
      Icon: () => (
        <EntityIcon targetType="chat" size="shrinkFill" theme="monochrome" />
      ),
      action: () =>
        createBlock({
          blockName: 'chat',
          createFn: async () => {
            const result = await createChat({ projectId: props.projectId });
            if ('error' in result) {
              console.error(result.error);
              throw new Error('Failed to create chat');
            }
            return result.chatId;
          },
        }),
    },
    {
      label: 'Canvas',
      blockName: 'canvas' as BlockName,
      hotkeyToken: TOKENS.global.create.canvas,
      Icon: () => (
        <EntityIcon targetType="canvas" size="shrinkFill" theme="monochrome" />
      ),
      action: () =>
        createBlock({
          blockName: 'canvas',
          loading: true,
          createFn: async () => {
            const result = await createCanvasFileFromJsonString({
              json: JSON.stringify({ nodes: [], edges: [] }),
              title: 'New Canvas',
              projectId: props.projectId,
            });
            if ('error' in result) {
              console.error(result.error);
              throw new Error('Failed to create canvas');
            }
            return result.documentId;
          },
        }),
    },
    {
      label: 'Project',
      blockName: 'project' as BlockName,
      hotkeyToken: TOKENS.global.create.project,
      Icon: () => (
        <EntityIcon targetType="project" size="shrinkFill" theme="monochrome" />
      ),
      action: () =>
        createBlock({
          blockName: 'project',
          createFn: async () => {
            const createProject = useCreateProject();
            const result = await createProject({
              name: 'New Project',
              parentId: props.projectId,
            });
            if (!result) throw new Error('Failed to create project');
            return result;
          },
        }),
    },
  ];

  return (
    <DropdownMenu.Content
      class="isolate relative flex flex-col gap-2 bg-dialog -mb-1 p-2 border-2 border-accent min-w-max bracket-never"
      ref={ref}
    >
      <For each={CREATABLE_BLOCKS}>
        {(item, index) => <MenuItem {...item} index={index() + 1} />}
      </For>
    </DropdownMenu.Content>
  );
}

export function ProjectCreateMenu(props: { id: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <DropdownMenu open={open()} onOpenChange={setOpen}>
      <div class="flex items-center">
        <DropdownMenu.Trigger class="h-min">
          <Button size="XS" active={open()}>
            Create
          </Button>
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <MenuContent projectId={props.id} />
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
