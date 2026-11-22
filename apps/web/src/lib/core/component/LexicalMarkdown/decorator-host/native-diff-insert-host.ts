import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import type { DiffInsertHost } from './diff-insert-host';
import type { NativeDecoratorContext } from './native-adapter';

/** Read the diff owner from the bound view's acknowledged mirror only. */
export function createNativeDiffInsertContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<DiffInsertHost> & { dispose(): void } {
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let alive = true;
  const currentView = () =>
    alive &&
    view &&
    generation !== null &&
    view.mirror.keyGeneration === generation
      ? view
      : undefined;
  return {
    theme,
    host: {
      diffInsert: {
        owner(key) {
          const index = Number(key);
          if (
            !Number.isSafeInteger(index) ||
            index < 0 ||
            String(index) !== key
          )
            return null;
          const mounted = currentView();
          const node = mounted?.node(index);
          if (!mounted || node?.type !== 'diff-insert' || node.parent === null)
            return null;
          const parent = mounted.node(node.parent);
          if (parent?.type !== 'diff') return null;
          const userId = parent.props().userId;
          if (userId !== undefined && typeof userId !== 'string')
            throw new Error('Invalid native diff user id');
          return { userId };
        },
      },
    },
    bindView(incoming) {
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      alive = false;
      view = undefined;
    },
  };
}
