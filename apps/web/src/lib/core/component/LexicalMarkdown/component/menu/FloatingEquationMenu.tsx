import clickOutside from '@core/directive/clickOutside';
import { useCanEdit } from '@core/signal/permissions';
import Check from '@icon/system/regular/check-circle.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Tooltip } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '../../context/FloatingMenuContext';
import { useDecoratorHost } from '../../decorator-host/use-decorator-host';
import { floatWithElement } from '../../directive/floatWithElement';
import { floatWithSelection } from '../../directive/floatWithSelection';
import { Equation } from '../decorator/Equation';

false && floatWithSelection;
false && floatWithElement;
false && clickOutside;

export function FloatingEquationMenu(
  props: { canEdit?: Accessor<boolean> } = {}
) {
  const canEdit = props.canEdit ?? useCanEdit();
  const host = useDecoratorHost();

  const [menuOpen, setMenuOpen] = createMenuOpenSignal(
    'equation-menu',
    MenuPriority.Low,
    false
  );
  const [equation, setEquation] = createSignal('');
  const [inline, setInline] = createSignal(true);

  const [isNewEquation, setIsNewEquation] = createSignal(true);
  const [nodeKey, setNodeKey] = createSignal('');

  let inputElement: HTMLInputElement | undefined;
  let textAreaElement: HTMLTextAreaElement | undefined;

  const resetMenu = () => {
    setMenuOpen(false);
    setEquation('');
    setInline(true);

    setIsNewEquation(true);
    setNodeKey('');
  };

  const toggleInlineMode = createCallback(() => {
    setInline(!inline());
  });

  const getSelection = () => {
    if (nodeKey()) {
      return null;
    }
    return window.getSelection();
  };

  const getElement = createCallback(() => {
    const currentNodeKey = nodeKey();
    if (currentNodeKey) {
      return host.equation.element(currentNodeKey);
    }
    return null;
  });

  const handleClickEquation = createCallback((nodeKey: string) => {
    if (menuOpen()) {
      resetMenu();
      return;
    }

    const node = host.equation.current(nodeKey);
    if (!node) {
      resetMenu();
      return;
    }

    setNodeKey(nodeKey);
    setIsNewEquation(false);
    setEquation(node.equation);
    setInline(node.inline);
    setMenuOpen(true);
  });

  const handleCreateEquation = createCallback(() => {
    if (menuOpen()) {
      resetMenu();
      return;
    }
    setMenuOpen(true);
  });

  const handleSubmit = createCallback(() => {
    if (isNewEquation()) {
      handleInsertEquation();
    } else {
      handleUpdateEquation();
    }
  });

  const handleInsertEquation = createCallback(() => {
    const currentEquation = equation();
    if (!currentEquation) {
      resetMenu();
      return;
    }

    host.equation.insert?.(currentEquation, inline());

    resetMenu();
  });

  const handleUpdateEquation = createCallback(() => {
    const currentEquation = equation();
    if (!currentEquation) {
      resetMenu();
      return;
    }

    const currentNodeKey = nodeKey();
    if (!currentNodeKey) {
      resetMenu();
      return;
    }

    host.equation.update(currentNodeKey, currentEquation);

    resetMenu();
  });

  createEffect(() => {
    if (!canEdit()) return;
    host.equation.registerMenu({
      edit: handleClickEquation,
      create: handleCreateEquation,
    });
  });

  const keydown = (e: KeyboardEvent) => {
    if (!menuOpen()) {
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      resetMenu();
      host.equation.focus();
    }
    if (e.key === 'Enter' && inline()) {
      e.preventDefault();
      handleSubmit();
    }
  };

  createEffect(() => {
    if (menuOpen()) {
      setTimeout(() => {
        if (inline() && inputElement) {
          inputElement.focus();
        } else if (!inline() && textAreaElement) {
          textAreaElement.focus();
        }
      }, 0);
    }
  });

  onMount(() => {
    window.addEventListener('keydown', keydown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', keydown);
  });

  return (
    <Show when={menuOpen()}>
      <div
        class="menu-surface p-4 fixed top-0 left-0 z-action-menu w-96"
        use:floatWithElement={{ element: getElement }}
        use:floatWithSelection={{
          selection: untrack(getSelection),
          reactiveOnContainer: host.equation.root(),
        }}
        use:clickOutside={() => resetMenu()}
      >
        <div class="flex flex-col gap-3">
          <h3 class="text-sm font-medium text-ink">LaTeX Expression</h3>
          <div class="flex flex-col items-start gap-4">
            <div class="w-full grow">
              {inline() ? (
                <input
                  tabIndex={2}
                  ref={inputElement}
                  type="text"
                  value={equation() ?? ''}
                  onInput={(e) => setEquation(e.currentTarget.value)}
                  placeholder="Enter LaTeX expression"
                  class="w-full p-2 border border-edge rounded-md focus:ring focus:ring-accent/40 focus:border-accent/40 outline-none transition"
                />
              ) : (
                <textarea
                  tabIndex={2}
                  ref={textAreaElement}
                  rows={3}
                  value={equation() ?? ''}
                  onInput={(e) => setEquation(e.currentTarget.value)}
                  placeholder="Enter LaTeX expression"
                  class="w-full p-2 border border-edge rounded-md focus:ring focus:ring-accent/40 focus:border-accent/40 outline-none transition resize-none"
                />
              )}
            </div>
            <h3 class="text-sm font-medium text-ink">Rendered LaTeX</h3>
            <div class="min-h-12 max-h-40 w-full p-2 border border-edge rounded-md bg-edge overflow-auto">
              <Equation equation={equation()} inline={inline()} />
            </div>
          </div>
          <div class="flex items-center justify-between pt-2 border-t border-edge">
            <Show when={isNewEquation()} fallback={<div />}>
              <label class="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  class="size-4 rounded"
                  checked={inline()}
                  onChange={toggleInlineMode}
                />
                Inline equation
              </label>
            </Show>
            <Tooltip label="Apply changes">
              <button
                onClick={handleSubmit}
                disabled={!equation()}
                class="px-3 py-1.5 bg-accent/80 text-surface rounded-md hover:bg-accent transition disabled:bg-edge disabled:cursor-not-allowed flex items-center gap-1.5 text-sm font-medium"
              >
                <Check class="size-4" />
                {isNewEquation() ? 'Insert' : 'Update'}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </Show>
  );
}
