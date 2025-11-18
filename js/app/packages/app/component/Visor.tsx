import { getClippedOverlayRect } from '@app/util/getClippedOverlayRect';
import { getScrollElementParent } from '@app/util/getScrollElementParent';
import { Hotkey } from '@core/component/Hotkey';
import { CommandWithInfo, useActiveCommands } from '@core/hotkey/getCommands';
import { hotkeyScopeTree } from '@core/hotkey/state';
import { tokenMap } from '@core/hotkey/tokens';
import type { HotkeyCommand, ValidHotkey } from '@core/hotkey/types';
import {
  getActiveCommandByToken,
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
  createEffect,
  createMemo,
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
  hotkey: ValidHotkey;
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

  const runVisor = () => {
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
        const command = getActiveCommandByToken(token);
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

        setVisorLabels([]);

        runVisor();
      },
      { defer: true }
    )
  );
  onCleanup(() => {
    componentStack.pop();
  });

  return (
    <>
      <WhichKey />
      <div>
        <For each={visorLabels}>
          {(jumpLabel) => <VisorLabelOverlay {...jumpLabel} />}
        </For>
      </div>
    </>
  );
};

function WhichKey() {
  const activeCommands = useActiveCommands({ hideCommandsWithoutHotkeys: true});

  const commandsWithActivateScope = createMemo(() => {
    return activeCommands().filter(
      (command) => command.activateCommandScopeId
    );
  });

  const commandsWithoutActivateScope = createMemo(() => {
    return activeCommands().filter(
      (command) => !command.activateCommandScopeId
    );
  });

  return (
    <div class="absolute z-9999 left-1/2 top-1/2 translate-x-[-50%] translate-y-[-50%] max-w-80ch w-1/2">
      <div class="absolute -z-1 top-4 left-4 pattern-edge pattern-diagonal-4 opacity-100 w-full h-full mask-r-from-[calc(100%_-_1rem)] mask-b-from-[calc(100%_-_1rem)]" />
      <div class="p-2 w-full h-full bg-dialog border-2 border-accent text-sm">
        <div class="mb-4">
          <h3 class="font-medium mb-2">Modes</h3>
          <For each={commandsWithActivateScope()}>
            {(command) => (
              <div class="grid grid-cols-[8ch_1fr] gap-2">
                <Hotkey
                  class="font-mono"
                  token={command.hotkeyToken}
                  shortcut={prettyPrintHotkeyString(command.hotkeys.at(0))}
                />
                <div>
                  {typeof command.description === 'function'
                    ? command.description()
                    : command.description}{' '}
                </div>
              </div>
            )}
          </For>
        </div>

        <div>
          <h3 class="font-medium mb-2">Commands</h3>
          <For each={commandsWithoutActivateScope()}>
            {(command) => (
              <div class="grid grid-cols-[8ch_1fr] gap-2">
                <Hotkey
                  class="font-mono"
                  token={command.hotkeyToken}
                  shortcut={prettyPrintHotkeyString(command.hotkeys.at(0))}
                />
                <div>
                  {typeof command.description === 'function'
                    ? command.description()
                    : command.description}{' '}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

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
          <Hotkey shortcut={prettyPrintHotkeyString(props.hotkey)} />
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
