import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { EquationHost } from './equation-host';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

/** Edit existing equations through the current session; creation is not exposed. */
export function createNativeEquationContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<EquationHost> & { dispose(): void } {
  const selection = createNativeSelectionDecoratorContext(theme);
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let menu: Parameters<EquationHost['equation']['registerMenu']>[0] | undefined;
  let alive = true;
  const currentView = () =>
    alive &&
    view &&
    generation !== null &&
    view.mirror.keyGeneration === generation
      ? view
      : undefined;
  const target = (key: string) => {
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key)
      return undefined;
    const node = currentView()?.node(index);
    return node?.type === 'equation' ? node : undefined;
  };
  return {
    theme,
    host: {
      isSelected: selection.host.isSelected,
      equation: {
        requestEdit(key) {
          if (target(key)) menu?.edit(key);
        },
        current(key) {
          const data = target(key)?.props();
          return data &&
            typeof data.equation === 'string' &&
            typeof data.inline === 'boolean'
            ? { equation: data.equation, inline: data.inline }
            : null;
        },
        element(key) {
          const node = target(key);
          return node
            ? (currentView()?.getElementByKey(node.key) ?? null)
            : null;
        },
        registerMenu(callbacks) {
          if (alive) menu ??= callbacks;
        },
        update(key, equation) {
          const mounted = currentView();
          const node = target(key);
          if (mounted && node)
            dispatchApplicationCommandIfSessionEdit(
              mounted,
              'group-b.equation',
              { key: node.key, equation }
            );
        },
        root: () => currentView()?.root ?? null,
        focus() {
          currentView()?.focus();
        },
      },
    },
    bindView(incoming) {
      selection.bindView(incoming);
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      alive = false;
      menu = undefined;
      selection.dispose();
      view = undefined;
      generation = null;
    },
  };
}
