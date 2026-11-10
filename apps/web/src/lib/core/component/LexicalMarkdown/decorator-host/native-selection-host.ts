import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import { createSignal } from 'solid-js';
import type { NativeDecoratorContext } from './native-adapter';
import type { DecoratorSelectionHost } from './selection-host';

/** One actual view and selection subscription; the owner disposes this context. */
export function createNativeSelectionDecoratorContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<DecoratorSelectionHost> & { dispose(): void } {
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let release: (() => void) | undefined;
  let alive = true;
  const [selection, setSelection] =
    createSignal<
      ReturnType<DecoratorProps['view']['selection']>['selection']
    >();
  return {
    theme,
    host: {
      isSelected(sourceKey) {
        if (
          !alive ||
          !view ||
          generation === null ||
          view.mirror.keyGeneration !== generation
        )
          return false;
        const key = Number(sourceKey);
        if (
          !Number.isSafeInteger(key) ||
          String(key) !== sourceKey ||
          !view.node(key) ||
          !view.getElementByKey(key)
        )
          return false;
        const current = selection();
        return current?.kind === 'node' && current.keys.includes(key);
      },
    },
    bindView(incoming) {
      if (!alive) throw new Error('Selection decorator context is disposed');
      const currentGeneration = incoming.mirror.keyGeneration;
      if (currentGeneration === null)
        throw new Error('Missing acknowledged view generation');
      if (view) {
        if (view !== incoming || generation !== currentGeneration)
          throw new Error(
            'Selection decorator context belongs to another view generation'
          );
        return;
      }
      view = incoming;
      generation = currentGeneration;
      setSelection(incoming.selection().selection);
      release = incoming.onCommit(() =>
        setSelection(incoming.selection().selection)
      );
    },
    dispose() {
      alive = false;
      release?.();
      release = undefined;
      view = undefined;
      setSelection(undefined);
    },
  };
}
