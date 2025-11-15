import type { BlockName } from '@core/block';
import { getIconConfig } from '@core/component/EntityIcon';
import { Hotkey } from '@core/component/Hotkey';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import {
  registerHotkey,
  useHotkeyDOMScope,
  type ValidHotkey,
} from '@core/hotkey/hotkeys';
import {
  createCanvasFileFromJsonString,
  createChat,
  createCodeFileFromText,
  createMarkdownFile,
} from '@core/util/create';
import { isErr } from '@core/util/maybeResult';
import { Dialog } from '@kobalte/core/dialog';
import PixelChat from '@macro-icons/pixel/ai.svg';
import PixelArrowRight from '@macro-icons/pixel/arrow-right.svg';
import PixelCanvas from '@macro-icons/pixel/canvas.svg';
import PixelChannel from '@macro-icons/pixel/channel.svg';
import PixelCode from '@macro-icons/pixel/code.svg';
import PixelEmail from '@macro-icons/pixel/email.svg';
import PixelMd from '@macro-icons/pixel/notes.svg';

import {
  type Component,
  createEffect,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';

import { type FocusableElement, tabbable } from 'tabbable';

import { useSplitLayout } from '../split-layout/layout';

type LauncherMenuItemProps = {
  label: string;
  blockName: BlockName;
  hotkeyLetter?: string;
  hotkeyToken: string;
  hotkey: ValidHotkey;
  onClick: (e?: MouseEvent) => void | Promise<void>;
  Icon: Component;
  displayPriority: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  focused?: boolean;
};

const USE_ENTITY_COLORS = true;

const LauncherMenuItem = (props: LauncherMenuItemProps) => {
  let buttonRef!: HTMLButtonElement;

  createEffect(() => {
    if (props.focused) {
      buttonRef?.focus();
    }
  });

  const textFg = () =>
    USE_ENTITY_COLORS
      ? getIconConfig(props.blockName ?? 'pdf').foreground
      : 'text-accent';

  return (
    <button
      class={`create-menu-${props.label.toLowerCase()} size-32 relative flex flex-col sm:gap-4 gap-2 items-center isolate justify-center bg-panel border border-edge transition-transform ease-click duration-200`}
      classList={{
        '-translate-y-2 text-ink bracket-offset-1': props.focused,
        'text-ink-extra-muted': !props.focused,
      }}
      onClick={props.onClick}
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
          [getIconConfig(props.blockName ?? 'pdf').background]: true,
          'scale-y-0': !props.focused,
          'scale-y-100': props.focused,
        }}
      ></div>

      <div class="absolute top-1.5 left-2 font-mono z-1 bg-panel text-accent font-bold">
        <Hotkey shortcut={props.hotkeyLetter} />
      </div>

      <div
        class="absolute size-2 right-2 top-2 z-1 transition-transform ease-click duration-200 transition-color border border-edge/50"
        classList={{
          [textFg()]: true,
        }}
        style={{ background: props.focused ? 'currentColor' : 'transparent' }}
      />

      <div class="w-full py-1 px-2 absolute bottom-0 flex flex-row justify-between items-center z-1">
        <div class="text-sm font-bold uppercase font-stretch-condensed">{props.label}</div>
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
        <props.Icon />
      </div>
    </button>
  );
};

type LauncherInnerProps = {
  onClose: () => void;
};

const LauncherInner = (props: LauncherInnerProps) => {
  const { replaceSplit, insertSplit } = useSplitLayout();

  const [attachHotkeys, launcherScope] = useHotkeyDOMScope(
    'create-menu.type',
    true
  );

  let ref!: HTMLDivElement;

  const [focusedIndex, setFocusedIndex] = createSignal(0);

  const openInSplit = (
    type: BlockName,
    id: string,
    mode: 'current' | 'new'
  ) => {
    if (mode === 'new') {
      insertSplit({
        type: type,
        id: id,
      });
    } else {
      replaceSplit({
        type: type,
        id: id,
      });
    }

    props.onClose();
  };

  const handleNewCode = async (mode: 'current' | 'new' = 'current') => {
    const maybeDoc = await createCodeFileFromText({
      code: 'print("Hello, World!")',
      extension: 'py',
      title: 'New Code File',
    });

    if (isErr(maybeDoc)) {
      console.error('Failed to create new code:', maybeDoc);
      return;
    }

    const [, result] = maybeDoc;
    if (result?.documentId) {
      openInSplit('code', result.documentId, mode);
    }
  };

  const handleNewNote = async (mode: 'current' | 'new' = 'current') => {
    const documentId = await createMarkdownFile({
      title: '',
      content: '',
      projectId: undefined,
    });

    if (documentId) {
      openInSplit('md', documentId, mode);
    }
  };

  const handleNewCanvas = async (mode: 'current' | 'new' = 'current') => {
    const emptyCanvasJson = JSON.stringify({
      nodes: [],
      edges: [],
    });

    const result = await createCanvasFileFromJsonString({
      json: emptyCanvasJson,
      title: 'New Canvas',
    });

    if ('error' in result) {
      console.error('Failed to create new canvas:', result.error);
      return;
    }

    if (result.documentId) {
      openInSplit('canvas', result.documentId, mode);
    }
  };

  const handleNewChat = async (mode: 'current' | 'new' = 'current') => {
    const maybeChat = await createChat();

    if (!maybeChat.chatId) {
      console.error('Failed to create new chat:', maybeChat);
      return;
    }

    const { chatId } = maybeChat;

    if (!chatId) return;

    openInSplit('chat', chatId, mode);
  };

  const handleNewEmail = (mode: 'current' | 'new' = 'current') => {
    if (mode === 'new') {
      insertSplit({
        type: 'component',
        id: 'email-compose',
      });
    } else {
      replaceSplit({
        type: 'component',
        id: 'email-compose',
      });
    }
    props.onClose();
  };

  const handleNewMessage = (mode: 'current' | 'new' = 'current') => {
    if (mode === 'new') {
      insertSplit({
        type: 'component',
        id: 'channel-compose',
      });
    } else {
      replaceSplit({
        type: 'component',
        id: 'channel-compose',
      });
    }
    props.onClose();
  };

  const actionHandlers = {
    note: handleNewNote,
    email: handleNewEmail,
    message: handleNewMessage,
    ai: handleNewChat,
    canvas: handleNewCanvas,
    code: handleNewCode,
  };

  const executeCurrentItem = (mode: 'current' | 'new') => {
    const currentItem = launcherMenuItems[focusedIndex()];

    if (currentItem) {
      const handlerKey =
        currentItem.label.toLowerCase() as keyof typeof actionHandlers;

      if (actionHandlers[handlerKey]) {
        actionHandlers[handlerKey](mode);
      }
    }
  };

  const launcherMenuItems: LauncherMenuItemProps[] = [
    {
      label: 'Note',
      blockName: 'md',
      hotkeyLetter: 'n',
      hotkeyToken: 'global.create.note',
      hotkey: 'n',
      onClick: (e) => handleNewNote(e?.altKey ? 'new' : 'current'),
      Icon: () => <PixelMd class="w-full h-full" />,
      displayPriority: 5,
    },
    {
      label: 'Email',
      blockName: 'email',
      hotkeyLetter: 'e',
      hotkeyToken: 'global.create.email',
      hotkey: 'e',
      onClick: (e) => handleNewEmail(e?.altKey ? 'new' : 'current'),
      Icon: () => <PixelEmail class="w-full h-full" />,
      displayPriority: 4,
    },
    {
      label: 'Message',
      blockName: 'channel',
      hotkeyLetter: 'm',
      hotkeyToken: 'global.create.message',
      hotkey: 'm',
      onClick: (e) => handleNewMessage(e?.altKey ? 'new' : 'current'),
      Icon: () => <PixelChannel class="w-full h-full" />,
      displayPriority: 3,
    },
    {
      label: 'AI',
      blockName: 'chat',
      hotkeyLetter: 'a',
      hotkeyToken: 'global.create.chat',
      hotkey: 'a',
      onClick: (e) => handleNewChat(e?.altKey ? 'new' : 'current'),
      Icon: () => <PixelChat class="w-full h-full" />,
      displayPriority: 2,
    },
    {
      label: 'Canvas',
      blockName: 'canvas',
      hotkeyLetter: 'd',
      hotkeyToken: 'global.create.canvas',
      hotkey: 'd',
      onClick: (e) => handleNewCanvas(e?.altKey ? 'new' : 'current'),
      Icon: () => <PixelCanvas class="w-full h-full" />,
      displayPriority: 1,
    },
    {
      label: 'Code',
      blockName: 'code',
      hotkeyLetter: 'c',
      hotkeyToken: 'global.create.code',
      hotkey: 'c',
      onClick: (e) => handleNewCode(e?.altKey ? 'new' : 'current'),
      Icon: () => <PixelCode class="w-full h-full" />,
      displayPriority: 0,
    },
  ];

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

  launcherMenuItems.forEach((item, index) => {
    registerHotkey({
      hotkeyToken: item.hotkeyToken,
      hotkey: [item.hotkey],
      scopeId: launcherScope,
      description: `Create ${item.label.charAt(0).toUpperCase() + item.label.slice(1).toLowerCase()}`,
      keyDownHandler: () => {
        setFocusedIndex(index);
        item.onClick();
        return true;
      },
      displayPriority: item.displayPriority,
    });

    // Register option+letter hotkeys to open in new split
    registerHotkey({
      hotkeyToken: `${item.hotkeyToken}.newSplit`,
      hotkey: `opt+${item.hotkey}` as ValidHotkey,
      scopeId: launcherScope,
      description: `Create ${item.label.charAt(0).toUpperCase() + item.label.slice(1).toLowerCase()} in new split`,
      keyDownHandler: () => {
        setFocusedIndex(index);
        item.onClick({ altKey: true } as MouseEvent);
        return true;
      },
      displayPriority: item.displayPriority,
    });
  });

  registerHotkey({
    hotkeyToken: 'global.create.left',
    hotkey: 'arrowleft',
    scopeId: launcherScope,
    description: 'Navigate Left',
    keyDownHandler: () => moveFocus(-1),
    displayPriority: 0,
  });

  registerHotkey({
    hotkeyToken: 'global.create.right',
    hotkey: 'arrowright' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Navigate Right',
    keyDownHandler: () => moveFocus(1),
    displayPriority: 0,
  });

  registerHotkey({
    hotkeyToken: 'global.create.escape',
    hotkey: 'escape',
    scopeId: launcherScope,
    description: 'Exit',
    keyDownHandler: () => {
      props.onClose();
      return true;
    },
    displayPriority: 0,
  });

  registerHotkey({
    hotkeyToken: 'global.create.enter',
    hotkey: 'enter',
    scopeId: launcherScope,
    description: 'Open in current split',
    keyDownHandler: () => {
      executeCurrentItem('current');
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 7,
  });

  registerHotkey({
    hotkeyToken: 'global.create.opt-enter',
    hotkey: 'opt+enter' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Open in new split',
    keyDownHandler: () => {
      executeCurrentItem('new');
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 8,
  });

  onMount(() => {
    if (!ref) return;

    attachHotkeys(ref);

    setTimeout(() => {
      const firstItem = launcherMenuItems[0];

      if (firstItem) {
        focusMenuItem(firstItem.label);
      }
    }, 0);
  });

  return (
    <div>
      <div
        class="relative grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 p-6 isolate bg-menu pattern-edge pattern-dot-3 border border-edge/50 suppress-css-brackets"
        ref={ref}
      >
        <div class="absolute pointer-events-none size-full inset-0 pulse-corners"></div>

        <For each={launcherMenuItems}>
          {(item, index) => (
            <LauncherMenuItem
              {...item}
              onMouseEnter={() => setFocusedIndex(index())}
              onFocus={() => setFocusedIndex(index())}
              focused={focusedIndex() === index()}
            />
          )}
        </For>


      </div>
      <div class="col-span-full font-mono text-sm text-ink-muted text-center pt-4">
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
          class="fixed inset-0 z-modal bg-modal-overlay"
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
