import type { BlockAlias, BlockName } from '@core/block';
import { getIconConfig } from '@core/component/EntityIcon';
import { Hotkey } from '@core/component/Hotkey';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import {
  ENABLE_ANIMATED_ICONS,
  ENABLE_CREATE_TASK,
} from '@core/constant/featureFlags';
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
import PixelArrowRight from '@macro-icons/pixel/arrow-right.svg';
import { AnimatedChatIcon } from '@macro-icons/wide/animating/chat';
import { AnimatedDiagramIcon } from '@macro-icons/wide/animating/diagram';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedFileCodeIcon } from '@macro-icons/wide/animating/fileCode';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import WideChat from '@macro-icons/wide/chat.svg';
import WideDiagram from '@macro-icons/wide/diagram.svg';
import WideEmail from '@macro-icons/wide/email.svg';
import WideFileCode from '@macro-icons/wide/file-code.svg';
import WideFileMd from '@macro-icons/wide/file-md.svg';
import WideFolder from '@macro-icons/wide/folder.svg';
import WideStar from '@macro-icons/wide/star.svg';
import WideTask from '@macro-icons/wide/task.svg';
import { createProject } from '@queries/storage/projects';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type FocusableElement, tabbable } from 'tabbable';
import { useSplitLayout } from './split-layout/layout';

const createBlock = async (spec: {
  blockName: BlockName | BlockAlias;
  createFn: () => Promise<string | undefined>;
  loading?: boolean;
  shouldInsert?: boolean;
}) => {
  const { openWithSplit } = useSplitLayout();
  const { blockName, createFn, loading } = spec;

  setCreateMenuOpen(false, false);

  if (!loading) {
    const id = await createFn();
    if (!id) return;

    const block = { type: blockName, id };

    openWithSplit(block, {
      referredFrom: 'launcher',
      preferNewSplit: spec.shouldInsert,
    });

    return;
  } else {
    const split = openWithSplit(
      { type: 'component', id: 'loading' },
      {
        referredFrom: 'launcher',
        preferNewSplit: spec.shouldInsert,
      }
    );

    const id = await createFn();
    if (!id) {
      split?.goBack();
      return;
    }

    if (split)
      split.replace({
        next: { type: blockName, id },
        mergeHistory: true,
        referredFrom: 'launcher',
      });
  }
};

const createComponent = async (spec: {
  componentId: string;
  shouldInsert?: boolean;
  asPopover?: boolean;
}) => {
  const { openWithSplit, popoverSplit } = useSplitLayout();

  // For popovers, create the popover BEFORE closing launcher
  // so the popover can acquire the focus lock while launcher still owns rootFocusElement
  if (spec.asPopover) {
    popoverSplit({ type: 'component', id: spec.componentId });
    setCreateMenuOpen(false, false);
    return;
  }

  setCreateMenuOpen(false, false);

  openWithSplit(
    { type: 'component', id: spec.componentId },
    {
      referredFrom: 'launcher',
      preferNewSplit: spec.shouldInsert,
    }
  );
};

type CreatableBlock = Omit<HotkeyRegistrationOptions, 'scopeId'> & {
  label: string;
  blockName: BlockName;
  altHotkeyToken?: HotkeyToken;
  animatedIcon?: Component<{ triggerAnimation?: boolean }>;
};

export const CREATABLE_BLOCKS: CreatableBlock[] = [
  {
    label: 'Doc',
    icon: WideFileMd,
    animatedIcon: AnimatedFileMdIcon,
    description: 'Create doc',
    blockName: 'md',
    hotkeyToken: TOKENS.create.note,
    altHotkeyToken: TOKENS.create.noteNewSplit,
    hotkey: 'd',
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
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  ...(ENABLE_CREATE_TASK
    ? [
        {
          label: 'Task',
          icon: WideTask,
          animatedIcon: AnimatedTaskIcon,
          description: 'Create task',
          blockName: 'task' as BlockName,
          hotkeyToken: TOKENS.create.task,
          altHotkeyToken: TOKENS.create.taskNewSplit,
          hotkey: 't' as const,
          keyDownHandler: () => {
            createComponent({
              componentId: 'task-compose',
              asPopover: true,
            });
            return true;
          },
        },
      ]
    : []),
  {
    label: 'Email',
    icon: WideEmail,
    animatedIcon: AnimatedEmailIcon,
    description: 'Create email',
    blockName: 'email',
    hotkeyToken: TOKENS.create.email,
    altHotkeyToken: TOKENS.create.emailNewSplit,
    hotkey: 'l',
    keyDownHandler: () => {
      createComponent({
        componentId: 'email-compose',
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  {
    label: 'Message',
    icon: WideChat,
    animatedIcon: AnimatedChatIcon,
    description: 'Create message',
    blockName: 'channel',
    hotkeyToken: TOKENS.create.message,
    altHotkeyToken: TOKENS.create.messageNewSplit,
    hotkey: 'm',
    keyDownHandler: () => {
      createComponent({
        componentId: 'channel-compose',
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  {
    label: 'Agent',
    icon: WideStar,
    animatedIcon: AnimatedStarIcon,
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
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  {
    label: 'Canvas',
    icon: WideDiagram,
    animatedIcon: AnimatedDiagramIcon,
    description: 'Create canvas',
    blockName: 'canvas',
    hotkeyToken: TOKENS.create.canvas,
    altHotkeyToken: TOKENS.create.canvasNewSplit,
    hotkey: 'n',
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
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  {
    label: 'Folder',
    icon: WideFolder,
    animatedIcon: AnimatedFolderIcon,
    description: 'Create folder',
    blockName: 'project',
    hotkeyToken: TOKENS.create.project,
    altHotkeyToken: TOKENS.create.projectNewSplit,
    hotkey: 'f',
    keyDownHandler: () => {
      createBlock({
        blockName: 'project',
        createFn: () => createProject({ name: 'New Folder' }),
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  {
    label: 'Code',
    icon: WideFileCode,
    animatedIcon: AnimatedFileCodeIcon,
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
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
];

const USE_ENTITY_COLORS = true;

export const [createMenuOpen, setCreateMenuOpen] = createControlledOpenSignal(
  false,
  { id: 'launcher' }
);

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
      ? getIconConfig(props.creatableBlock.blockName).foreground
      : 'text-accent';

  const StaticIcon = props.creatableBlock.icon;
  const AnimatedIcon = props.creatableBlock.animatedIcon;

  return (
    <button
      class={`create-menu-${props.creatableBlock.label.toLowerCase()} size-28 relative flex flex-col sm:gap-4 gap-2 items-center isolate justify-center bg-panel border border-edge-muted transition-transform ease-click duration-200`}
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
      {/** TODO (seamus): we need to pool/cache these canvases. they brick the color picker/or any other gl context
                because they do not get garbage collected fast enough */}
      {/*<div
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
      </div>*/}

      <div
        class="absolute size-full inset-0 transition-transform origin-top opacity-20 ease duration-200 mix-blend-color"
        classList={{
          [getIconConfig(props.creatableBlock.blockName).background]: true,
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
        <div class="text-sm font-bold font-stretch-condensed">
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
        <Show
          when={ENABLE_ANIMATED_ICONS && AnimatedIcon}
          fallback={<Dynamic component={StaticIcon} />}
        >
          {(Icon) => (
            <Dynamic component={Icon()} triggerAnimation={props.focused} />
          )}
        </Show>
      </div>
    </button>
  );
};

type LauncherInnerProps = {
  onClose: (shouldReturnFocus?: boolean) => void;
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
        props.onClose(false);
        return true;
      },
    });

    if (item.altHotkeyToken) {
      registerHotkey({
        hotkeyToken: item.altHotkeyToken,
        hotkey: `shift+${item.hotkey}` as ValidHotkey,
        scopeId: launcherScope,
        description: `${item.description} in current split`,
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
    description: 'Open in new split',
    keyDownHandler: () => {
      CREATABLE_BLOCKS[focusedIndex()].keyDownHandler();
      props.onClose();
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 7,
  });

  registerHotkey({
    hotkey: 'enter' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Open in current split',
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

  // horrible but tailwind requires the full strings
  const gridColsClass = () => {
    const length = CREATABLE_BLOCKS.length;
    if (length >= 8) return 'xl:grid-cols-8';
    if (length >= 7) return 'xl:grid-cols-7';
    if (length >= 6) return 'xl:grid-cols-6';
    if (length >= 5) return 'xl:grid-cols-5';
    return '';
  };

  return (
    <div>
      <div
        class="relative grid grid-cols-2 sm:grid-cols-4 gap-3 p-6 isolate bg-menu border border-edge-muted suppress-css-brackets"
        classList={{
          [gridColsClass()]: true,
        }}
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
        Hold shift to open in current split
      </div>
    </div>
  );
};

type LauncherProps = {
  open: boolean;
  onOpenChange: (open: boolean, shouldReturnFocus?: boolean) => void;
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
          <div
            class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                props.onOpenChange(false);
              }
            }}
          >
            <LauncherInner
              onClose={(shouldReturnFocus) =>
                props.onOpenChange(false, shouldReturnFocus)
              }
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};
