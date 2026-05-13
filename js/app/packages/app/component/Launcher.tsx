import { analytics } from '@app/lib/analytics';
import { setAutomationComposerOpen } from '@block-automation/component';
import type { BlockAlias, BlockName } from '@core/block';
import { getIconConfig } from '@core/component/EntityIcon';
import { ENABLE_ANIMATED_ICONS } from '@core/constant/featureFlags';
import {
  createHotkeyGroup,
  registerHotkey,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { pressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type {
  HotkeyRegistrationOptions,
  ValidHotkey,
} from '@core/hotkey/types';
import { isMobile } from '@core/mobile/isMobile';
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
import { cn, Hotkey, Layer } from '@ui';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  onCleanup,
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

  // WORKAROUND: On mobile, the navigation interceptor in createMobileSwipeLayout
  // consumes openWithSplit calls and returns undefined instead of a SplitHandle.
  // This means we can't show a loading spinner then replace it via split.replace(),
  // because we never get a handle back. Instead, on mobile we skip the loading state
  // and navigate directly to the created block after the async creation completes.
  // If the mobile navigation interceptor is refactored to return handles, this
  // workaround can be removed and both paths can use the loading-then-replace flow.
  const showLoadingFirst = loading && !isMobile();

  const split = showLoadingFirst
    ? openWithSplit(
        { type: 'component', id: 'loading' },
        { referredFrom: 'launcher', preferNewSplit: spec.shouldInsert }
      )
    : undefined;

  const id = await createFn();
  if (!id) {
    split?.goBack();
    return;
  }

  analytics.track('create_entity', {
    entityType: blockName,
    source: 'launcher',
  });

  if (split) {
    split.replace({
      next: { type: blockName, id },
      mergeHistory: true,
      referredFrom: 'launcher',
    });
  } else {
    openWithSplit(
      { type: blockName, id },
      {
        referredFrom: 'launcher',
        preferNewSplit: spec.shouldInsert,
      }
    );
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

export function runCreateAction(
  blockName: BlockName | BlockAlias,
  options: { shouldInsert?: boolean } = {}
) {
  const shouldInsert = options.shouldInsert ?? false;

  switch (blockName) {
    case 'md':
      createBlock({
        blockName: 'md',
        loading: true,
        createFn: () =>
          createMarkdownFile({
            title: '',
            content: '',
            projectId: undefined,
          }),
        shouldInsert,
      });
      return;
    case 'canvas':
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
        shouldInsert,
      });
      return;
    case 'task':
      createComponent({
        componentId: 'task-compose',
        asPopover: true,
      });
      return;
    case 'email':
      createComponent({
        componentId: 'email-compose',
        shouldInsert,
      });
      return;
    case 'channel':
      createComponent({
        componentId: 'channel-compose',
        shouldInsert,
      });
      return;
    case 'chat':
      createBlock({
        blockName: 'chat',
        createFn: async () => {
          const result = await createChat();
          if ('error' in result) {
            return;
          }
          return result.chatId;
        },
        shouldInsert,
      });
      return;
    case 'project':
      createBlock({
        blockName: 'project',
        createFn: () => createProject({ name: 'New Folder' }),
        shouldInsert,
      });
      return;
    case 'code':
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
        shouldInsert,
      });
      return;
    case 'automation':
      setCreateMenuOpen(false, false);
      setAutomationComposerOpen(true, false);
      return;
  }
}

export type CreatableBlock = Omit<HotkeyRegistrationOptions, 'scopeId'> & {
  label: string;
  blockName: BlockName | BlockAlias;
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
      runCreateAction('md', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Task',
    icon: WideTask,
    animatedIcon: AnimatedTaskIcon,
    description: 'Create task',
    blockName: 'task',
    hotkeyToken: TOKENS.create.task,
    altHotkeyToken: TOKENS.create.taskNewSplit,
    hotkey: 't' as const,
    keyDownHandler: () => {
      runCreateAction('task');
      return true;
    },
  },
  {
    label: 'Email',
    icon: WideEmail,
    animatedIcon: AnimatedEmailIcon,
    description: 'Create email',
    blockName: 'email',
    hotkeyToken: TOKENS.create.email,
    altHotkeyToken: TOKENS.create.emailNewSplit,
    hotkey: 'e',
    keyDownHandler: () => {
      runCreateAction('email', { shouldInsert: pressedKeys().has('shift') });
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
      runCreateAction('channel', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Agent',
    icon: WideStar,
    animatedIcon: AnimatedStarIcon,
    description: 'Create AI chat',
    blockName: 'chat',
    hotkeyToken: TOKENS.create.chat,
    altHotkeyToken: TOKENS.create.chatNewSplit,
    hotkey: 'a',
    keyDownHandler: () => {
      runCreateAction('chat', { shouldInsert: pressedKeys().has('shift') });
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
      runCreateAction('canvas', {
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
      runCreateAction('project', { shouldInsert: pressedKeys().has('shift') });
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
      runCreateAction('code', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
];

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

  const textFg = () => getIconConfig(props.creatableBlock.blockName).foreground;

  const StaticIcon = props.creatableBlock.icon;
  const AnimatedIcon = props.creatableBlock.animatedIcon;

  return (
    <Layer depth={2}>
      <button
        class={cn(
          ' size-28 relative flex flex-col sm:gap-4 gap-2 items-center isolate justify-center bg-surface ring ring-edge-muted transition-transform ease-out duration-200 rounded-sm',
          `create-menu-${props.creatableBlock.label.toLowerCase()}`,
          {
            '-translate-y-2 text-ink': props.focused,
            'text-ink-extra-muted': !props.focused,
          }
        )}
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
          class={cn(
            'absolute size-full inset-0 transition-transform origin-top ease duration-200',
            getIconConfig(props.creatableBlock.blockName).background,
            {
              'opacity-0': !props.focused,
              'opacity-20': props.focused,
            }
          )}
        ></div>

        <div class="absolute top-1.5 left-2 z-user-highlight p-1 px-1.5 text-ink border border-edge-muted rounded-xs text-xs">
          <Hotkey token={props.creatableBlock.hotkeyToken} />
        </div>

        <div
          class={cn(
            'absolute size-2 right-2 top-2 z-user-highlight transition-transform ease-out duration-200 transition-color border border-edge',
            textFg()
          )}
          style={{ background: props.focused ? 'currentColor' : 'transparent' }}
        />

        <div class="w-full py-1 px-2 absolute bottom-0 flex flex-row justify-between items-center z-user-highlight">
          <div class="text-sm font-bold">{props.creatableBlock.label}</div>
          <div class="size-3">
            <PixelArrowRight />
          </div>
        </div>

        <div
          class={cn(
            'w-1/3 -translate-y-1 transition-all ease-out duration-200',
            textFg(),
            {
              'text-edge': !props.focused,
              'scale-110': props.focused,
            }
          )}
        >
          <Show
            when={ENABLE_ANIMATED_ICONS && AnimatedIcon}
            fallback={<Dynamic component={StaticIcon} />}
          >
            {(icon) => (
              <Dynamic component={icon()} triggerAnimation={props.focused} />
            )}
          </Show>
        </div>
      </button>
    </Layer>
  );
};

type LauncherInnerProps = {
  onClose: (shouldReturnFocus?: boolean) => void;
  blocks?: CreatableBlock[];
};

export const LauncherInner = (props: LauncherInnerProps) => {
  const hkGroup = createHotkeyGroup();
  const blocks = () => props.blocks ?? CREATABLE_BLOCKS;
  const [attachHotkeys, launcherScope] = useHotkeyDOMScope('create-menu', true);

  let ref!: HTMLDivElement;
  let shiftRippleRef: HTMLSpanElement | undefined;

  const shiftHeld = () => pressedKeys().has('shift');

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

  // Mirrors the grid-cols-2 / sm:grid-cols-4 / xl:grid-cols-N classes in the JSX
  const getColumnCount = () => {
    const width = window.innerWidth;
    const length = blocks().length;
    if (width >= 1280) {
      if (length >= 8) return 8;
      if (length >= 7) return 7;
      if (length >= 6) return 6;
      if (length >= 5) return 5;
      return 4;
    }
    if (width >= 640) return 4;
    return 2;
  };

  const moveFocus = (delta: number) => {
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

  blocks().forEach((item) => {
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
    }).withGroup(hkGroup);

    if (item.altHotkeyToken) {
      registerHotkey({
        hotkeyToken: item.altHotkeyToken,
        hotkey: `shift+${item.hotkey}` as ValidHotkey,
        scopeId: launcherScope,
        description: `${item.description} in new split`,
        keyDownHandler: () => {
          item.keyDownHandler();
          props.onClose();
          return true;
        },
      }).withGroup(hkGroup);
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
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: ['arrowleft', 'h'],
    scopeId: launcherScope,
    description: 'Navigate Left',
    keyDownHandler: () => moveFocus(-1),
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: ['arrowright', 'l'],
    scopeId: launcherScope,
    description: 'Navigate Right',
    keyDownHandler: () => moveFocus(1),
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: ['arrowup', 'k'],
    scopeId: launcherScope,
    description: 'Navigate Up',
    keyDownHandler: (e) => {
      e?.preventDefault();
      return moveFocus(-getColumnCount());
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: ['arrowdown', 'j'],
    scopeId: launcherScope,
    description: 'Navigate Down',
    keyDownHandler: (e) => {
      e?.preventDefault();
      return moveFocus(getColumnCount());
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'escape',
    scopeId: launcherScope,
    description: 'Exit',
    keyDownHandler: () => {
      props.onClose();
      return true;
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'shift+enter',
    scopeId: launcherScope,
    description: 'Open in new split',
    keyDownHandler: () => {
      blocks()[focusedIndex()]?.keyDownHandler();
      props.onClose();
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 7,
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'enter' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Open in current split',
    keyDownHandler: () => {
      blocks()[focusedIndex()]?.keyDownHandler();
      props.onClose();
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 8,
  }).withGroup(hkGroup);

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !e.repeat && shiftRippleRef) {
        shiftRippleRef.classList.remove('rippling');
        void shiftRippleRef.offsetWidth; // reflow to restart animation
        shiftRippleRef.classList.add('rippling');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  onMount(() => {
    if (!ref) return;
    attachHotkeys(ref);
    setTimeout(() => {
      const firstItem = blocks()[0];
      if (firstItem) {
        focusMenuItem(firstItem.label);
      }
    });
  });

  onCleanup(hkGroup.dispose);

  // horrible but tailwind requires the full strings
  const gridColsClass = () => {
    const length = blocks().length;
    if (length >= 8) return 'xl:grid-cols-8';
    if (length >= 7) return 'xl:grid-cols-7';
    if (length >= 6) return 'xl:grid-cols-6';
    if (length >= 5) return 'xl:grid-cols-5';
    return '';
  };

  return (
    <div class="bg-surface ring-1 ring-edge-muted rounded-sm">
      <div class="flex items-center justify-between p-2 px-6 border-b border-edge-muted">
        <h1 class="font-bold text-ink-muted">Create New</h1>
        <p class="gap-2 text-ink-extra-muted text-xs items-center hidden touch:hidden md:flex">
          <style>{`
            @keyframes shift-ripple {
              0%   { transform: scale(1); opacity: 0.6; }
              100% { transform: scale(2.2); opacity: 0; }
            }
            .shift-ripple.rippling {
              animation: shift-ripple 0.35s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
            }
          `}</style>
          Hold{' '}
          <span class="relative inline-grid place-items-center my-1">
            <span
              ref={shiftRippleRef}
              class="shift-ripple absolute inset-0 rounded-sm border border-accent pointer-events-none opacity-0"
            />
            <span
              class={cn(
                'px-1 py-0.5 rounded-sm h-fit ring text-xs grid place-items-center transition-colors duration-150',
                shiftHeld()
                  ? 'ring-accent text-accent bg-accent/10'
                  : 'ring-edge-muted'
              )}
            >
              <Hotkey shortcut="shift" />
            </span>
          </span>
          to launch in new split
        </p>
      </div>
      <div
        class={cn(
          'relative grid grid-cols-2 sm:grid-cols-4 gap-3 p-6 isolate brackets-never',
          gridColsClass()
        )}
        ref={ref}
      >
        <For each={blocks()}>
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
    </div>
  );
};

type LauncherProps = {
  open: boolean;
  onOpenChange: (open: boolean, shouldReturnFocus?: boolean) => void;
};

export const Launcher = (props: LauncherProps) => {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={true}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"></Dialog.Overlay>
        <Dialog.Content>
          <Layer depth={1}>
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
          </Layer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};
