import { Tooltip } from '@core/component/Tooltip';
import clickOutside from '@core/directive/clickOutside';
import { useCanEdit } from '@core/signal/permissions';
import Check from '@icon/regular/check-circle.svg';
import { $isEquationNode } from '@lexical-core';
import { createCallback } from '@solid-primitives/rootless';
import { $getNodeByKey } from 'lexical';
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '../../context/FloatingMenuContext';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  INSERT_EQUATION_COMMAND,
  katexPlugin,
  UPDATE_EQUATION_COMMAND,
} from '../../plugins';
import { Equation } from '../decorator/Equation';

false && floatWithSelection;
false && floatWithElement;
false && clickOutside;

export function FloatingEquationMenu() {
  const canEdit = useCanEdit();
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const plugins = () => lexicalWrapper?.plugins;
  const editor = () => lexicalWrapper?.editor;

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
      const currentNode = $getNodeByKey(currentNodeKey);
      const currentEditor = editor();
      if (currentNode && currentEditor) {
        return currentEditor.getElementByKey(currentNodeKey);
      }
    }
    return null;
  });

  const handleClickEquation = createCallback((nodeKey: string) => {
    if (menuOpen()) {
      resetMenu();
      return;
    }

    const node = $getNodeByKey(nodeKey);
    if (!$isEquationNode(node)) {
      resetMenu();
      return;
    }

    setNodeKey(nodeKey);
    setIsNewEquation(false);
    setEquation(node.__equation);
    setInline(node.__inline);
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

    const currentEditor = editor();
    if (!currentEditor) {
      resetMenu();
      return;
    }

    currentEditor.dispatchCommand(INSERT_EQUATION_COMMAND, {
      equation: currentEquation,
      inline: inline(),
    });

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

    const currentEditor = editor();
    if (!currentEditor) {
      resetMenu();
      return;
    }

    currentEditor.dispatchCommand(UPDATE_EQUATION_COMMAND, {
      nodeKey: currentNodeKey,
      equation: currentEquation,
    });

    resetMenu();
  });

  createEffect(() => {
    const currentPlugins = plugins();
    if (!currentPlugins) return;

    if (!canEdit()) return;

    currentPlugins.use(
      katexPlugin({
        onClickEquation: handleClickEquation,
        onCreateEquation: handleCreateEquation,
      })
    );
  });

  const keydown = (e: KeyboardEvent) => {
    if (!menuOpen()) {
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      resetMenu();
      editor()?.focus();
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
        class="p-4 fixed bg-menu top-0 left-0 z-action-menu rounded-lg shadow-lg w-96 border border-edge"
        use:floatWithElement={{ element: getElement }}
        use:floatWithSelection={{
          selection: untrack(getSelection),
          reactiveOnContainer: editor()?.getRootElement(),
        }}
        use:clickOutside={() => resetMenu()}
      >
        <div class="flex flex-col gap-3">
          <h3 class="text-sm font-medium text-ink">LaTeX Expression</h3>
          <div class="flex flex-col items-start gap-4">
            <div class="w-full flex-grow">
              {inline() ? (
                <input
                  tabIndex={2}
                  ref={inputElement}
                  type="text"
                  value={equation() ?? ''}
                  onInput={(e) => setEquation(e.currentTarget.value)}
                  placeholder="Enter LaTeX expression"
                  class="w-full p-2 border border-edge rounded-md focus:ring-1 focus:ring-accent/40 focus:border-accent/40 outline-none transition"
                />
              ) : (
                <textarea
                  tabIndex={2}
                  ref={textAreaElement}
                  rows={3}
                  value={equation() ?? ''}
                  onInput={(e) => setEquation(e.currentTarget.value)}
                  placeholder="Enter LaTeX expression"
                  class="w-full p-2 border border-edge rounded-md focus:ring-1 focus:ring-accent/40 focus:border-accent/40 outline-none transition resize-none"
                />
              )}
            </div>
            <h3 class="text-sm font-medium text-ink">Rendered LaTeX</h3>
            <div class="min-h-12 max-h-40 w-full p-2 border border-edge rounded-md bg-edge/20 overflow-auto">
              <Equation equation={equation()} inline={inline()} />
            </div>
          </div>
          <div class="flex items-center justify-between pt-2 border-t border-edge">
            <Show when={isNewEquation()} fallback={<div />}>
              <label class="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  class="w-4 h-4 rounded"
                  checked={inline()}
                  onChange={toggleInlineMode}
                />
                Inline equation
              </label>
            </Show>
            <Tooltip tooltip="Apply changes">
              <button
                onClick={handleSubmit}
                disabled={!equation()}
                class="px-3 py-1.5 bg-accent/80 text-menu rounded-md hover:bg-accent transition disabled:bg-edge/80 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm font-medium"
              >
                <Check class="w-4 h-4" />
                {isNewEquation() ? 'Insert' : 'Update'}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </Show>
  );
}
