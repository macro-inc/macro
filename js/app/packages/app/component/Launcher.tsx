import type { BlockName } from '@core/block';
import { getIconConfig } from '@core/component/EntityIcon';
import { Hotkey } from '@core/component/Hotkey';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
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
  createCodeFileFromText,
  createMarkdownFile,
} from '@core/util/create';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { isErr, ok } from '@core/util/maybeResult';
import { Dialog } from '@kobalte/core/dialog';
import PixelChat from '@macro-icons/pixel/ai.svg';
import PixelArrowRight from '@macro-icons/pixel/arrow-right.svg';
import PixelCanvas from '@macro-icons/pixel/canvas.svg';
import PixelChannel from '@macro-icons/pixel/channel.svg';
import PixelCode from '@macro-icons/pixel/code.svg';
import PixelEmail from '@macro-icons/pixel/email.svg';
import PixelProject from '@macro-icons/pixel/folder-alt.svg';
import PixelMd from '@macro-icons/pixel/notes.svg';
import { useCreateProject } from '@service-storage/projects';
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { type FocusableElement, tabbable } from 'tabbable';
import { useSplitLayout } from './split-layout/layout';

const createBlock = async (spec: {
  blockName: BlockName;
  createFn: () => Promise<string | undefined>;
  loading?: boolean;
  shouldInsert?: boolean;
}) => {
  const { replaceSplit, insertSplit } = useSplitLayout();
  const { blockName, createFn, loading } = spec;

  setCreateMenuOpen(false);

  if (!loading) {
    const id = await createFn();
    if (!id) return;

    const block = { type: blockName, id };

    spec.shouldInsert ? insertSplit(block) : replaceSplit(block);
  } else {
    const split = spec.shouldInsert
      ? insertSplit({ type: 'component', id: 'loading' })
      : replaceSplit({ type: 'component', id: 'loading' });

    const id = await createFn();
    if (!id) {
      split?.goBack();
      return;
    }

    if (split) split.replace({ type: blockName, id }, true);
  }
};

const createComponent = async (spec: {
  componentId: string;
  shouldInsert?: boolean;
}) => {
  setCreateMenuOpen(false);
  const { replaceSplit, insertSplit } = useSplitLayout();
  if (spec.shouldInsert) {
    insertSplit({ type: 'component', id: spec.componentId });
  } else {
    replaceSplit({ type: 'component', id: spec.componentId });
  }
};

type CreatableBlock = Omit<HotkeyRegistrationOptions, 'scopeId'> & {
  label: string;
  blockName: BlockName;
  altHotkeyToken?: HotkeyToken;
};

export const CREATABLE_BLOCKS: CreatableBlock[] = [
  {
    label: 'Note',
    icon: () => <PixelMd />,
    description: 'Create note',
    blockName: 'md',
    hotkeyToken: TOKENS.create.note,
    altHotkeyToken: TOKENS.create.noteNewSplit,
    hotkey: 'n',
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
        shouldInsert: pressedKeys().has('opt'),
      });
      return true;
    },
  },
  {
    label: 'Email',
    icon: () => <PixelEmail />,
    description: 'Create email',
    blockName: 'email',
    hotkeyToken: TOKENS.create.email,
    altHotkeyToken: TOKENS.create.emailNewSplit,
    hotkey: 'e',
    keyDownHandler: () => {
      createComponent({
        componentId: 'email-compose',
        shouldInsert: pressedKeys().has('opt'),
      });
      return true;
    },
  },
  {
    label: 'Message',
    icon: () => <PixelChannel />,
    description: 'Create message',
    blockName: 'channel',
    hotkeyToken: TOKENS.create.message,
    altHotkeyToken: TOKENS.create.messageNewSplit,
    hotkey: 'm',
    keyDownHandler: () => {
      createComponent({
        componentId: 'channel-compose',
        shouldInsert: pressedKeys().has('opt'),
      });
      return true;
    },
  },
  {
    label: 'AI',
    icon: () => <PixelChat />,
    description: 'Create AI chat',
    blockName: 'chat' as BlockName,
    hotkeyToken: TOKENS.create.chat,
    altHotkeyToken: TOKENS.create.chatNewSplit,
    hotkey: 'a',
    keyDownHandler: () => {
      createBlock({
        blockName: 'chat',
        createFn: async () => {
          const result = await createChat();
          if ('error' in result) {
            return;
          }
          return result.chatId;
        },
        shouldInsert: pressedKeys().has('opt'),
      });
      return true;
    },
  },
  {
    label: 'Canvas',
    icon: () => <PixelCanvas />,
    description: 'Create canvas',
    blockName: 'canvas',
    hotkeyToken: TOKENS.create.canvas,
    altHotkeyToken: TOKENS.create.canvasNewSplit,
    hotkey: 'd',
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
        shouldInsert: pressedKeys().has('opt'),
      });
      return true;
    },
  },
  {
    label: 'Folder',
    icon: () => <PixelProject />,
    description: 'Create folder',
    blockName: 'project',
    hotkeyToken: TOKENS.create.project,
    altHotkeyToken: TOKENS.create.projectNewSplit,
    hotkey: 'f',
    keyDownHandler: () => {
      createBlock({
        blockName: 'project',
        createFn: () => {
          const createProject = useCreateProject();
          return createProject({ name: 'New Folder' });
        },
        shouldInsert: pressedKeys().has('opt'),
      });
      return true;
    },
  },
  {
    label: 'Code',
    icon: () => <PixelCode />,
    description: 'Create code file',
    blockName: 'code',
    hotkeyToken: TOKENS.create.code,
    altHotkeyToken: TOKENS.create.codeNewSplit,
    hotkey: 'o',
    keyDownHandler: () => {
      createBlock({
        blockName: 'code',
        loading: true,
        createFn: async () => {
          const result = await createCodeFileFromText({
            code: 'print("Hello, World!")',
            extension: 'py',
            title: 'New Code File',
          });
          if (isErr(result)) return;
          const [, id] = ok(result[1]?.documentId);
          return id;
        },
        shouldInsert: pressedKeys().has('opt'),
      });
      return true;
    },
  },
];

const USE_ENTITY_COLORS = true;

export const [createMenuOpen, setCreateMenuOpen] = createControlledOpenSignal();

type LauncherMenuItemProps = {
  creatableBlock: CreatableBlock;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  focused?: boolean;
};

const LauncherMenuItem = (props: LauncherMenuItemProps) => {
  let buttonRef!: HTMLButtonElement;

  createEffect(() => {
    if (props.focused) {
      buttonRef?.focus();
    }
  });

  const textFg = () =>
    USE_ENTITY_COLORS
      ? getIconConfig(props.creatableBlock.blockName ?? 'pdf').foreground
      : 'text-accent';

  const Icon = props.creatableBlock.icon;

  return (
    <button
      class={`create-menu-${props.creatableBlock.label.toLowerCase()} size-32 relative flex flex-col sm:gap-4 gap-2 items-center isolate justify-center bg-panel border border-edge-muted transition-transform ease-click duration-200`}
      classList={{
        '-translate-y-2 text-ink bracket-offset-1': props.focused,
        'text-ink-extra-muted': !props.focused,
      }}
      onClick={() => props.creatableBlock.keyDownHandler()}
      onFocus={props.onFocus}
      onMouseEnter={props.onMouseEnter}
      tabindex={0}
      ref={buttonRef}
      onPointerEnter={() => {
        buttonRef?.focus();
      }}
    >
      <div
        class="inset-0 absolute bg-panel opacity-2 mask-b-from-0% mask-b-to-100%"
        classList={{
          'text-ink-extra-muted opacity-2': !props.focused,
          [textFg() + ' opacity-50']: props.focused,
        }}
      >
        <PcNoiseGrid
          cellSize={21 / 2}
          rounding={10}
          warp={0}
          freq={0.002}
          crunch={0.4}
          size={[0.0, 0.2]}
          fill={1}
          stroke={0}
          speed={[props.focused ? 0.3 : 0, 0]}
        />
      </div>

      <div
        class="absolute size-full inset-0 transition-transform origin-top opacity-20 ease duration-200 mix-blend-color"
        classList={{
          [getIconConfig(props.creatableBlock.blockName ?? 'pdf').background]:
            true,
          'scale-y-0': !props.focused,
          'scale-y-100': props.focused,
        }}
      ></div>

      <div class="absolute top-1.5 left-2 z-1 p-1 px-1.5 bg-panel text-ink border border-edge-muted rounded-xs text-xs">
        <Hotkey token={props.creatableBlock.hotkeyToken} />
      </div>

      <div
        class="absolute size-2 right-2 top-2 z-1 transition-transform ease-click duration-200 transition-color border border-edge/50"
        classList={{
          [textFg()]: true,
        }}
        style={{ background: props.focused ? 'currentColor' : 'transparent' }}
      />

      <div class="w-full py-1 px-2 absolute bottom-0 flex flex-row justify-between items-center z-1">
        <div class="text-sm font-bold uppercase font-stretch-condensed">
          {props.creatableBlock.label}
        </div>
        <div class="size-3">
          <PixelArrowRight />
        </div>
      </div>

      <div
        class="w-1/3 -translate-y-1 transition-all ease-click duration-200"
        classList={{
          [textFg()]: props.focused,
          'text-edge': !props.focused,
          'scale-110': props.focused,
        }}
      >
        {Icon && <Icon />}
      </div>
    </button>
  );
};

type LauncherInnerProps = {
  onClose: () => void;
};

const LauncherInner = (props: LauncherInnerProps) => {
  const [attachHotkeys, launcherScope] = useHotkeyDOMScope('create-menu', true);

  let ref!: HTMLDivElement;

  const [focusedIndex, setFocusedIndex] = createSignal(0);

  const focusMenuItem = (label: string) => {
    const menuItem = document.querySelector<HTMLElement>(
      `.create-menu-${label}`
    );

    if (menuItem) {
      menuItem.focus();
    }

    return true;
  };

  const moveFocus = (delta: -1 | 1) => {
    const tabbableEls = tabbable(ref);
    const activeEl = document.activeElement as FocusableElement | null;
    const activeElIndex = activeEl
      ? tabbableEls.indexOf(activeEl as FocusableElement)
      : -1;

    if (activeElIndex === -1 || tabbableEls.length === 0) return false;

    const nextIndex =
      (activeElIndex + delta + tabbableEls.length) % tabbableEls.length;

    const nextEl = tabbableEls[nextIndex];

    if (!nextEl) return false;

    nextEl.focus();

    setFocusedIndex(nextIndex);

    return true;
  };

  CREATABLE_BLOCKS.forEach((item) => {
    registerHotkey({
      hotkeyToken: item.hotkeyToken,
      hotkey: item.hotkey,
      scopeId: launcherScope,
      description: item.description,
      keyDownHandler: () => {
        item.keyDownHandler();
        props.onClose();
        return true;
      },
    });

    if (item.altHotkeyToken) {
      registerHotkey({
        hotkeyToken: item.altHotkeyToken,
        hotkey: `opt+${item.hotkey}` as ValidHotkey,
        scopeId: launcherScope,
        description: `${item.description} in new split`,
        keyDownHandler: () => {
          item.keyDownHandler();
          props.onClose();
          return true;
        },
      });
    }
  });

  registerHotkey({
    hotkey: 'c',
    scopeId: launcherScope,
    description: 'Close Launcher',
    condition: createMenuOpen,
    keyDownHandler: () => {
      setCreateMenuOpen(false);
      return true;
    },
  });
  registerHotkey({
    hotkey: 'arrowleft',
    scopeId: launcherScope,
    description: 'Navigate Left',
    keyDownHandler: () => moveFocus(-1),
  });

  registerHotkey({
    hotkey: 'arrowright' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Navigate Right',
    keyDownHandler: () => moveFocus(1),
  });

  registerHotkey({
    hotkey: 'escape',
    scopeId: launcherScope,
    description: 'Exit',
    keyDownHandler: () => {
      props.onClose();
      return true;
    },
  });

  registerHotkey({
    hotkey: 'enter',
    scopeId: launcherScope,
    description: 'Open in current split',
    keyDownHandler: () => {
      CREATABLE_BLOCKS[focusedIndex()].keyDownHandler();
      props.onClose();
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 7,
  });

  registerHotkey({
    hotkey: 'opt+enter' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Open in new split',
    keyDownHandler: () => {
      CREATABLE_BLOCKS[focusedIndex()].keyDownHandler();
      props.onClose();
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 8,
  });

  onMount(() => {
    if (!ref) return;

    attachHotkeys(ref);

    setTimeout(() => {
      const firstItem = CREATABLE_BLOCKS[0];

      if (firstItem) {
        focusMenuItem(firstItem.label);
      }
    }, 0);
  });

  return (
    <div>
      <div
        class="relative grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 p-6 isolate bg-menu border border-edge-muted suppress-css-brackets"
        ref={ref}
      >
        <div class="absolute pointer-events-none size-full inset-0"></div>

        <For each={CREATABLE_BLOCKS}>
          {(item, index) => (
            <LauncherMenuItem
              creatableBlock={item}
              onMouseEnter={() => setFocusedIndex(index())}
              onFocus={() => setFocusedIndex(index())}
              focused={focusedIndex() === index()}
            />
          )}
        </For>
      </div>
      <div class="col-span-full text-sm text-ink-muted text-center pt-4">
        Hold option to open in a new split view
      </div>
    </div>
  );
};

type LauncherProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const Launcher = (props: LauncherProps) => {
  const useJuicedScrim = false;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={true}>
      <Dialog.Portal>
        <Dialog.Overlay
          class="fixed inset-0 z-modal bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
          classList={{
            'backdrop-filter-[blur(0.5px)]': useJuicedScrim,
          }}
        >
          <Show when={useJuicedScrim}>
            <div class="absolute pointer-events-none size-full inset-0 bg-modal-overlay text-ink opacity-5">
              <PcNoiseGrid
                cellSize={20}
                crunch={0.379}
                size={[0, 1]}
                speed={[0.03, 0.4]}
                circleMask={1}
                stroke={1}
                fill={0}
              />
            </div>
          </Show>
        </Dialog.Overlay>

        <Dialog.Content>
          <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center">
            <LauncherInner onClose={() => props.onOpenChange(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};
