import { getClippedOverlayRect } from '@app/util/getClippedOverlayRect';
import { getScrollElementParent } from '@app/util/getScrollElementParent';
import { Hotkey } from '@core/component/Hotkey';
import { useHotkeyCommandByToken } from '@core/hotkey/hotkeys';
import { tokenMap } from '@core/hotkey/tokens';
import type { HotkeyCommand } from '@core/hotkey/types';
import { isScopeInActiveBranch } from '@core/hotkey/utils';
import {
  isElementVisibleInScrollElViewport,
  isElementVisibleInViewport,
} from '@core/util/isElementVisibleInViewport';
import { autoUpdate } from '@floating-ui/dom';
import {
  type Accessor,
  type Component,
  createEffect,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
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
  hotkey: string;
  command: HotkeyCommand;
  targetEl: HTMLElement;
  targetElScrollParent: HTMLElement | null;
};

const componentStack: string[] = [];
const [triggerVisor, setTriggerVisor] = createSignal<undefined>(undefined, {
  equals: () => false,
});
export const fireVisor = () => {
  setTriggerVisor();
};

const Visor: Component<{
  parent?: Accessor<Element | undefined>;
}> = (props) => {
  const componentId = createUniqueId();
  componentStack.push(componentId);
  const [visorLabels, setVisorLabels] = createStore<VisorLabel[]>([]);

  const removeAllOverlays = () => {
    setVisorLabels([]);
  };

  const [currentInput, setCurrentInput] = createSignal('');

  const runMacroJump = () => {
    const root = props.parent?.() ?? document.getElementById('root')!;

    const hotkeyEls = Array.from(
      root.querySelectorAll<HTMLElement>('[data-hotkey-token]')
    );

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
        const command = useHotkeyCommandByToken(token)();
        const primaryHotkey = command?.hotkeys?.[0];
        // We only want to show visor for hotkeys that are in the current active scope branch.
        if (
          !command ||
          !isScopeInActiveBranch(command.scopeId) ||
          !primaryHotkey
        ) {
          return acc;
        }

        acc.push({
          id,
          hotkey: primaryHotkey,
          command: command,
          targetEl: hotkeyEl,
          targetElScrollParent,
        } satisfies VisorLabel);
        return acc;
      }, []);

    setVisorLabels(newVisorLabels);

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    // If user clicks anywhere, exit
    document.addEventListener(
      'mousedown',
      () => {
        runCleanup();
      },
      { once: true }
    );
  };

  const runCleanup = () => {
    setCurrentInput('');
    removeAllOverlays();
    window.removeEventListener('keydown', handleKeyDown, {
      capture: true,
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {

    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      removeAllOverlays();
      window.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      });
      return;
    }

    runCleanup();
  };

  createEffect(
    on(
      triggerVisor,
      () => {
        if (componentStack.at(-1) !== componentId) return;

        setCurrentInput('');
        setVisorLabels([]);

        runMacroJump();
      },
      { defer: true }
    )
  );
  onCleanup(() => {
    componentStack.pop();
  });

  return (
    // <Portal mount={props.mount ?? document.getElementById('root')!}>
    <div>
      <For each={visorLabels}>
        {(jumpLabel) => <VisorLabelOverlay {...jumpLabel} />}
      </For>
    </div>
    // </Portal>
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
            'relative font-mono text-page font-bold w-fit bg-accent border-l-accent border-t-accent border-r-page border-b-page border p-[2px] text-xs z-[1]'
          }
        >
          <Hotkey shortcut={props.hotkey} />
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
