import { analytics } from '@app/lib/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { setAutomationComposerOpen } from '@block-automation/component';
import { EMAIL_COMPOSE_TO_INPUT_ID } from '@block-email/constants';
import type { BlockAlias, BlockName } from '@core/block';
import { getIconConfig } from '@core/component/EntityIcon';
import {
  ENABLE_ANIMATED_ICONS,
  ENABLE_SNIPPETS_FLAG,
  ENABLE_SNIPPETS_OVERRIDE,
} from '@core/constant/featureFlags';
import { triggerFocusInput } from '@core/directive/focusInput';
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
  createSnippet,
} from '@core/util/create';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { AnimatedChatIcon } from '@icon/wide-chat';
import WideChat from '@icon/wide-chat.svg';
import { AnimatedDiagramIcon } from '@icon/wide-diagram';
import WideDiagram from '@icon/wide-diagram.svg';
import { AnimatedEmailIcon } from '@icon/wide-email';
import WideEmail from '@icon/wide-email.svg';
import WideFileCode from '@icon/wide-file-code.svg';
import WideFileMd from '@icon/wide-file-md.svg';
import { AnimatedFileCodeIcon } from '@icon/wide-fileCode';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import WideFolder from '@icon/wide-folder.svg';
import { AnimatedSnippetIcon } from '@icon/wide-snippet';
import WideSnippet from '@icon/wide-snippet.svg';
import { AnimatedStarIcon } from '@icon/wide-star';
import WideStar from '@icon/wide-star.svg';
import { AnimatedTaskIcon } from '@icon/wide-task';
import WideTask from '@icon/wide-task.svg';
import { Dialog } from '@kobalte/core/dialog';
import { getMarkdownGoldenBytes } from '@lexical-core/markdown-golden';
import ArrowRight from '@phosphor/arrow-right.svg';
import { createProject } from '@queries/storage/projects';
import { cn, Hotkey, Layer } from '@ui';
import { getNormalizedKeyString } from '@ui/components/Hotkey';
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

  // If we are creating a new markdown document "from scratch" then we can let
  // them instantly start editing
  const createMdParams =
    blockName === 'md' || blockName === 'snippet'
      ? { optimisticSnapshot: await getMarkdownGoldenBytes() }
      : undefined;

  if (split) {
    split.replace({
      next: { type: blockName, id, params: createMdParams },
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
          return result.documentId ?? undefined;
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
    case 'snippet':
      createBlock({
        blockName: 'snippet',
        loading: true,
        createFn: () =>
          createSnippet({
            title: '',
            content: '',
          }),
        shouldInsert,
      });
      return;
    case 'email':
      // Focus the "To" field within this gesture so the iOS keyboard opens;
      // the compose mounts asynchronously, so this waits for the input.
      triggerFocusInput(() =>
        document.getElementById(EMAIL_COMPOSE_TO_INPUT_ID)
      );
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
          if (result.isErr()) return;
          return result.value.documentId ?? undefined;
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
    label: 'Snippet',
    icon: WideSnippet,
    animatedIcon: AnimatedSnippetIcon,
    description: 'Create snippet',
    blockName: 'snippet',
    hotkeyToken: TOKENS.create.snippet,
    altHotkeyToken: TOKENS.create.snippetNewSplit,
    hotkey: 's' as const,
    keyDownHandler: () => {
      runCreateAction('snippet', { shouldInsert: pressedKeys().has('shift') });
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
    <Layer depth={4}>
      <button
        class={cn(
          'size-28 shadow-sm shadow-drop-shadow relative flex flex-col sm:gap-4 gap-2 items-center isolate justify-center bg-surface ring ring-edge transition-transform ease-click duration-200 rounded-sm',
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
          <div class="text-sm font-medium">{props.creatableBlock.label}</div>
          <div
            class={cn(
              'size-3 transition-[transform,opacity] ease duration-200',
              {
                'opacity-100': props.focused,
                'opacity-0': !props.focused,
              }
            )}
          >
            <ArrowRight />
          </div>
        </div>

        <div
          class={cn(
            'w-1/3 -translate-y-1 transition-all ease-out duration-200',
            textFg(),
            {
              'text-ink-extra-muted': !props.focused,
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
  const snippetsFlag = useFeatureFlag(ENABLE_SNIPPETS_FLAG, {
    enabledOverride: ENABLE_SNIPPETS_OVERRIDE,
  });
  const blocks = () =>
    (props.blocks ?? CREATABLE_BLOCKS).filter(
      (block) => block.blockName !== 'snippet' || snippetsFlag().enabled
    );
  const [attachHotkeys, launcherScope] = useHotkeyDOMScope('create-menu', true);

  let ref!: HTMLDivElement;
  let shiftRippleRef: HTMLSpanElement | undefined;

  const shiftHeld = () => pressedKeys().has('shift');

  const [focusedIndex, setFocusedIndex] = createSignal(0);

  const focusMenuItem = (label: string) => {
    const menuItem = document.querySelector<HTMLElement>(
      `.create-menu-${label.toLowerCase()}`
    );

    if (!menuItem) return false;

    menuItem.focus();

    return true;
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

  const getGridColumnCount = () => {
    const columns = window.getComputedStyle(ref).gridTemplateColumns;
    return Math.max(columns.split(' ').filter(Boolean).length, 1);
  };

  const moveFocusRow = (direction: -1 | 1) => {
    const columnCount = getGridColumnCount();
    const nextIndex = focusedIndex() + columnCount * direction;

    if (nextIndex < 0 || nextIndex >= blocks().length) return false;

    const nextEl = tabbable(ref)[nextIndex];
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
      return moveFocusRow(-1);
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: ['arrowdown', 'j'],
    scopeId: launcherScope,
    description: 'Navigate Down',
    keyDownHandler: (e) => {
      e?.preventDefault();
      return moveFocusRow(1);
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

  return (
    <div class="bg-surface ring-1 ring-edge-muted rounded-xl max-w-[calc(100vw-2rem)]">
      <div class="flex items-center justify-between p-2 px-4 sm:px-6 border-b border-edge-muted">
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
          <span class="relative inline-flex place-items-center my-1">
            <span
              ref={shiftRippleRef}
              class="shift-ripple absolute inset-0 rounded-sm border border-accent pointer-events-none opacity-0"
            />
            <span
              class={cn(
                'ring text-xs px-1.5 py-0.5 rounded-sm transition-colors duration-150',
                shiftHeld()
                  ? 'ring-accent text-accent bg-accent/10'
                  : 'ring-edge-muted'
              )}
            >
              {getNormalizedKeyString({ shortcut: 'shift' })}
            </span>
          </span>
          to launch in new split
        </p>
      </div>
      <div
        class="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 justify-items-center gap-3 p-4 sm:p-6 isolate brackets-never"
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
          <Layer depth={3}>
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
