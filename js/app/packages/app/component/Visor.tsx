import { useSubscribeToKeypress } from '@app/signal/hotkeyRoot';
import { getClippedOverlayRect } from '@app/util/getClippedOverlayRect';
import { getScrollElementParent } from '@app/util/getScrollElementParent';
import { Hotkey } from '@core/component/Hotkey';
import { TOKENS, tokenMap } from '@core/hotkey/tokens';
import type { HotkeyCommand, ValidHotkey } from '@core/hotkey/types';
import {
  getActiveCommandByToken,
  getHotkeyCommandByToken,
  isScopeInActiveBranch,
  prettyPrintHotkeyString,
} from '@core/hotkey/utils';
import {
  isElementVisibleInScrollElViewport,
  isElementVisibleInViewport,
} from '@core/util/isElementVisibleInViewport';
import { autoUpdate } from '@floating-ui/dom';
import {
  type Accessor,
  type Component,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';

function isElementVisible(element: HTMLElement) {
  if (
    element.offsetParent === null ||
    getComputedStyle(element).visibility === 'hidden'
  ) {
    return false;
  }
  return true;
}

type VisorLabel = {
  id: string;
  hotkeys: ValidHotkey[];
  commands: HotkeyCommand[];
  targetEl: HTMLElement;
  targetElScrollParent: HTMLElement | null;
};

const [isVisorOpen, setIsVisorOpen] = createSignal(false);
export const fireVisor = () => {
  setIsVisorOpen(true);
};
export const resetVisor = () => {
  setIsVisorOpen(false);
};

const VisorInner: Component<{
  parent?: Accessor<Element | undefined>;
}> = (props) => {
  const [visorLabels, setVisorLabels] = createStore<VisorLabel[]>([]);

  useSubscribeToKeypress((context) => {
    if (
      !context.isEditableFocused &&
      !getHotkeyCommandByToken(TOKENS.global.toggleVisor)?.hotkeys?.some(
        (hotkey) => context.pressedKeysString === hotkey
      ) &&
      context.isNonModifierKeypress &&
      context.eventType === 'keydown'
    ) {
      resetVisor();
    }
  });

  const root = props.parent?.() ?? document.getElementById('root')!;

  const hotkeyEls = Array.from(
    root.querySelectorAll<HTMLElement>('[data-hotkey-token]')
  ).filter((el) => {
    const scopeElement = el.closest('[data-hotkey-scope]') as HTMLElement;
    if (!scopeElement) return false;

    const scopeId = scopeElement.dataset.hotkeyScope;
    return scopeId && isScopeInActiveBranch(scopeId);
  });

  const newVisorLabels: VisorLabel[] = hotkeyEls
    .filter((el) => {
      return (
        isElementVisible(el) &&
        isElementVisibleInViewport(el, {
          padding: {
            // include bottom navbar height to reduce viewport bottom
            // bottom: 32,
          },
        }) &&
        isElementVisibleInScrollElViewport(el).isVisible
      );
    })
    .reduce<VisorLabel[]>((acc, hotkeyEl) => {
      const targetElScrollParent = getScrollElementParent(hotkeyEl);
      const id = createUniqueId();
      const tokenString = hotkeyEl.dataset.hotkeyToken ?? '';
      const token = tokenMap.get(tokenString);
      if (!token) return acc;
      const commands = getActiveCommandByToken(token, true);
      if (!commands || commands.length === 0) return acc;

      // Collect all hotkeys from all commands
      const hotkeys: ValidHotkey[] = [];
      for (const command of commands) {
        // this will never actually break, because getActiveCommandByToken only returns commands if they all have hotkeys
        if (!command.hotkeys || command.hotkeys.length === 0) {
          break;
        }
        // Add the first hotkey from each command
        hotkeys.push(command.hotkeys[0]);
      }

      if (hotkeys.length === 0) return acc;

      acc.push({
        id,
        hotkeys,
        commands,
        targetEl: hotkeyEl,
        targetElScrollParent,
      } satisfies VisorLabel);
      return acc;
    }, []);

  console.log('newVisorLabels', newVisorLabels);
  setVisorLabels(newVisorLabels);

  // If user clicks anywhere, exit
  const handleMousedown = () => {
    setIsVisorOpen(false);
  };
  document.addEventListener('mousedown', handleMousedown);

  onCleanup(() => {
    document.removeEventListener('mousedown', handleMousedown);
  });

  return (
    <div>
      <For each={visorLabels}>
        {(jumpLabel) => <VisorLabelOverlay {...jumpLabel} />}
      </For>
    </div>
  );
};

const Visor: Component<{
  parent?: Accessor<Element | undefined>;
}> = (props) => {
  return (
    <Show when={isVisorOpen()}>
      <VisorInner {...props} />
    </Show>
  );
};

const VisorLabelOverlay: Component<VisorLabel> = (props) => {
  const [targetData, setTargetData] = createStore({
    isClippedBottom: false,
    isClippedLeft: false,
    isClippedRight: false,
    isClippedTop: false,
  });
  let overlayRef!: HTMLDivElement;

  onMount(() => {
    const overlay = overlayRef;

    // Get the element's position and dimensions to check if it's visible
    const targetRect = props.targetEl.getBoundingClientRect();
    if (targetRect.width === 0 || targetRect.height === 0) return null;
    const {
      rect: clippedRect,
      isClippedBottom,
      isClippedLeft,
      isClippedRight,
      isClippedTop,
    } = getClippedOverlayRect(props.targetEl, props.targetElScrollParent);

    overlay.style.left = `${clippedRect.left}px`;
    overlay.style.top = `${clippedRect.top}px`;
    overlay.style.width = `${clippedRect.width}px`;
    overlay.style.height = `${clippedRect.height}px`;

    setTargetData({
      isClippedBottom,
      isClippedLeft,
      isClippedRight,
      isClippedTop,
    });

    const updateOverlay = async () => {
      const {
        rect: clippedRect,
        isFullyClipped,
        isClippedBottom,
        isClippedLeft,
        isClippedRight,
        isClippedTop,
      } = getClippedOverlayRect(props.targetEl, props.targetElScrollParent);

      overlay.style.display = isFullyClipped ? 'none' : 'block';
      overlay.style.left = `${clippedRect.left}px`;
      overlay.style.top = `${clippedRect.top}px`;
      overlay.style.width = `${clippedRect.width}px`;
      overlay.style.height = `${clippedRect.height}px`;

      setTargetData({
        isClippedBottom,
        isClippedLeft,
        isClippedRight,
        isClippedTop,
      });
    };
    const cleanup = autoUpdate(props.targetEl, overlayRef, updateOverlay);
    onCleanup(() => {
      cleanup();
    });
  });

  return (
    <div
      class={
        'highlight-overlay fixed pointer-events-none z-[9999] border-page  border'
      }
      style={{
        'border-left-width': targetData.isClippedLeft ? '0' : '',
        'border-top-width': targetData.isClippedTop ? '0' : '',
        'border-right-width': targetData.isClippedRight ? '0' : '',
        'border-bottom-width': targetData.isClippedBottom ? '0' : '',
      }}
      data-target-id={props.id}
      ref={overlayRef}
    >
      <div
        class="relative w-full h-full border-accent border"
        style={{
          'background-color':
            'color-mix(in srgb, var(--color-accent) 10%, transparent)',
          'border-left-width': targetData.isClippedLeft ? '0' : '',
          'border-top-width': targetData.isClippedTop ? '0' : '',
          'border-right-width': targetData.isClippedRight ? '0' : '',
          'border-bottom-width': targetData.isClippedBottom ? '0' : '',
        }}
      >
        <div
          class={
            'relative font-mono text-page font-bold w-fit bg-accent border-l-accent border-t-accent border-r-page border-b-page border p-[2px] text-xs z-[1] flex items-center gap-1'
          }
        >
          <For each={props.hotkeys}>
            {(hotkey) => (
              <>
                <Hotkey shortcut={prettyPrintHotkeyString(hotkey)} />
              </>
            )}
          </For>
        </div>
        <div
          class="absolute inset-0 border-page border"
          style={{
            'border-left-width': targetData.isClippedLeft ? '0' : '',
            'border-top-width': targetData.isClippedTop ? '0' : '',
            'border-right-width': targetData.isClippedRight ? '0' : '',
            'border-bottom-width': targetData.isClippedBottom ? '0' : '',
          }}
        />
      </div>
    </div>
  );
};

export default Visor;
