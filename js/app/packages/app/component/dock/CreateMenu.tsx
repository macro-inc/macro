import type { BlockName } from '@core/block';
import { EntityIcon, getIconConfig } from '@core/component/EntityIcon';
import { BasicHotkey } from '@core/component/Hotkey';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { pressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type {
  HotkeyRegistrationOptions,
  ValidHotkey,
} from '@core/hotkey/types';
import {
  createCanvasFileFromJsonString,
  createChat,
  createMarkdownFile,
} from '@core/util/create';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { ok } from '@core/util/maybeResult';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import MacroCreateIcon from '@macro-icons/macro-create-b.svg';
import { useCreateProject } from '@service-storage/projects';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import { useSplitLayout } from '../split-layout/layout';

export const [createMenuOpen, setCreateMenuOpen] = createControlledOpenSignal();

export const toggleCreateMenu = () => {
  const isOpen = createMenuOpen();
  setCreateMenuOpen(!isOpen);
};

const createBlock = async (spec: {
  blockName: BlockName;
  createFn: () => Promise<string | undefined | null | false>;
  loading?: boolean;
}) => {
  const { replaceSplit, insertSplit } = useSplitLayout();
  const { blockName, createFn, loading } = spec;

  const shouldInsert = pressedKeys().has('opt');

  // TODO: order matters otherwise closing createMenu steals focus from other paywall modal
  setCreateMenuOpen(false);

  if (!loading) {
    const id = await createFn();
    if (!id) return;

    // Check if the result is an error before proceeding
    // MaybeResult error format: [ResultError[], null]
    // MaybeResult success format: [null, T]
    // String IDs are returned directly (not wrapped)
    if (Array.isArray(id) && id.length === 2 && id[0] !== null) {
      return;
    }

    const block = { type: blockName, id: id as string };

    shouldInsert ? insertSplit(block) : replaceSplit(block);
  } else {
    const split = shouldInsert
      ? insertSplit({ type: 'component', id: 'loading' })
      : replaceSplit({ type: 'component', id: 'loading' });

    const id = await createFn();
    if (!id) return;

    // Check if the result is an error before proceeding
    // MaybeResult error format: [ResultError[], null]
    // MaybeResult success format: [null, T]
    // String IDs are returned directly (not wrapped)
    if (Array.isArray(id) && id.length === 2 && id[0] !== null) {
      split?.goBack();
      return;
    }

    const actualId = id as string;

    if (!actualId) {
      split?.goBack();
    } else {
      if (split) split.replace({ type: blockName, id: actualId }, true);
    }
  }
};

const createComponent = async (spec: { componentId: string }) => {
  setCreateMenuOpen(false);
  const { replaceSplit, insertSplit } = useSplitLayout();
  const shouldInsert = pressedKeys().has('opt');
  if (shouldInsert) {
    insertSplit({ type: 'component', id: spec.componentId });
  } else {
    replaceSplit({ type: 'component', id: spec.componentId });
  }
};

export const CREATABLE_BLOCKS: (Omit<HotkeyRegistrationOptions, 'scopeId'> & {
  blockName: BlockName;
  altHotkeyToken?: HotkeyToken;
})[] = [
  {
    description: 'Create note',
    blockName: 'md' as BlockName,
    hotkeyToken: TOKENS.create.note,
    altHotkeyToken: TOKENS.create.noteNewSplit,
    hotkey: 'n' as ValidHotkey,
    keyDownHandler: () => {
      createBlock({
        blockName: 'md',
        loading: true,
        createFn: () =>
          createMarkdownFile({
            title: '',
            content: '',
            projectId: undefined,
          }),
      });
      return true;
    },
  },
  {
    description: 'Create email',
    blockName: 'email' as BlockName,
    hotkeyToken: TOKENS.create.email,
    altHotkeyToken: TOKENS.create.emailNewSplit,
    hotkey: 'e' as ValidHotkey,
    keyDownHandler: () => {
      createComponent({ componentId: 'email-compose' });
      return true;
    },
  },
  {
    description: 'Create message',
    blockName: 'channel' as BlockName,
    hotkeyToken: TOKENS.create.message,
    altHotkeyToken: TOKENS.create.messageNewSplit,
    hotkey: 'm' as ValidHotkey,
    keyDownHandler: () => {
      createComponent({ componentId: 'channel-compose' });
      return true;
    },
  },
  {
    description: 'Create AI chat',
    blockName: 'chat' as BlockName,
    hotkeyToken: TOKENS.create.chat,
    altHotkeyToken: TOKENS.create.chatNewSplit,
    hotkey: 'a' as ValidHotkey,
    keyDownHandler: () => {
      createBlock({
        blockName: 'chat',
        createFn: async () => {
          const result = await createChat();
          if ('error' in result) {
            return false;
          }
          return result.chatId;
        },
      });
      return true;
    },
  },
  {
    description: 'Create canvas',
    blockName: 'canvas' as BlockName,
    hotkeyToken: TOKENS.create.canvas,
    altHotkeyToken: TOKENS.create.canvasNewSplit,
    hotkey: 'd' as ValidHotkey,
    keyDownHandler: () => {
      createBlock({
        blockName: 'canvas',
        loading: true,
        createFn: async () => {
          const result = await createCanvasFileFromJsonString({
            json: JSON.stringify({ nodes: [], edges: [] }),
            title: 'New Canvas',
          });
          if ('error' in result) return;
          const [_, id] = ok(result.documentId);
          return id;
        },
      });
      return true;
    },
  },
  {
    description: 'Create project',
    blockName: 'project' as BlockName,
    hotkeyToken: TOKENS.create.project,
    altHotkeyToken: TOKENS.create.projectNewSplit,
    hotkey: 'p' as ValidHotkey,
    keyDownHandler: () => {
      createBlock({
        blockName: 'project',
        createFn: () => {
          const createProject = useCreateProject();
          return createProject({ name: 'New Project' });
        },
      });
      return true;
    },
  },
];

type MenuItemProps = {
  description: string | (() => string);
  blockName: BlockName;
  index?: number;
  hotkeyToken?: HotkeyToken;
  hotkey?: ValidHotkey | ValidHotkey[];
  keyDownHandler: () => boolean;
};

function MenuItem(props: MenuItemProps) {
  const selectedColor = getIconConfig(props.blockName ?? 'pdf').foreground;

  const description = createMemo(() => {
    const description =
      typeof props.description === 'function'
        ? props.description()
        : props.description;
    return `${description}${pressedKeys().has('opt') ? ' in new split' : ''}`;
  });

  const Icon = (props: { blockName: BlockName }) => {
    return (
      <EntityIcon
        targetType={props.blockName}
        size="shrinkFill"
        theme="monochrome"
      />
    );
  };

  return (
    <DropdownMenu.Item
      class={`flex justify-between gap-12 px-1.5 py-1 isolate transition-transform ease-click duration-200 text-ink-extra-muted data-highlighted:${selectedColor} data-highlighted:bracket-offset-4`}
      onSelect={props.keyDownHandler}
    >
      <div class="flex gap-1">
        <div class="size-6">
          <Icon blockName={props.blockName} />
        </div>
        <span>{description()}</span>
      </div>

      <Show when={props.hotkeyToken}>
        {(token) => <BasicHotkey token={token()} theme="muted" size="base" />}
      </Show>
    </DropdownMenu.Item>
  );
}

function MenuContent() {
  const [attachHotkeys, createMenuScope] = useHotkeyDOMScope(
    'create-menu.type',
    true
  );
  let ref!: HTMLDivElement;

  registerHotkey({
    hotkeyToken: TOKENS.create.close_menu,
    hotkey: 'c' as ValidHotkey,
    scopeId: createMenuScope,
    description: 'Close the create menu',
    keyDownHandler: () => {
      toggleCreateMenu();
      return true;
    },
  });

  onMount(() => {
    if (!ref) return;
    attachHotkeys(ref);

    CREATABLE_BLOCKS.forEach((item) => {
      registerHotkey({
        hotkeyToken: item.hotkeyToken,
        hotkey: item.hotkey,
        scopeId: createMenuScope,
        description: item.description,
        keyDownHandler: item.keyDownHandler,
      });

      // Alt variant (new split)
      if (item.altHotkeyToken) {
        registerHotkey({
          hotkeyToken: item.altHotkeyToken,
          hotkey: `opt+${item.hotkey}` as ValidHotkey,
          scopeId: createMenuScope,
          description: `${item.description} in new split`,
          keyDownHandler: item.keyDownHandler,
        });
      }
    });
  });

  return (
    <DropdownMenu.Content
      class="isolate relative flex flex-col gap-2 bg-dialog -mb-1 p-2 border-2 border-accent w-[16vw] min-w-max bracket-never"
      ref={ref}
    >
      <For each={CREATABLE_BLOCKS}>
        {(item, index) => <MenuItem {...item} index={index() + 1} />}
      </For>
    </DropdownMenu.Content>
  );
}

export function CreateMenu() {
  // onMount(() => setCreateMenuOpen(true))
  return (
    <DropdownMenu open={createMenuOpen()} onOpenChange={setCreateMenuOpen}>
      <DropdownMenu.Trigger
        class="relative flex justify-between items-center gap-2 data-expanded:bg-accent px-3 py-2 border border-edge-muted data-expanded:border-accent **:border-none! font-medium text-ink-muted data-expanded:text-default-bg hover:text-accent text-base bracket-never"
      >
        <span class="flex items-center">
          <MacroCreateIcon
            class={`h-2.5 ${createMenuOpen() ? 'fill-dialog/70' : 'fill-accent/70 transition-all duration-300'}`}
          />
        </span>
        <BasicHotkey
          shortcut="C"
          theme={createMenuOpen() ? 'muted' : 'muted'}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent />
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
