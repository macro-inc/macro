import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';
import type { DecoratorSelectionHost } from './selection-host';

/** Source chips that register a Normal-priority KEY_ENTER_COMMAND listener. */
export interface NormalEnterHost extends DecoratorSelectionHost {
  registerNormalEnter(
    listener: (event: KeyboardEvent | null) => boolean
  ): () => void;
}

/** Published UI selection, the actual native Normal-priority Enter slot, and the bound view. */
export function createNativeEnterDecoratorContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<NormalEnterHost> & {
  current(): DecoratorProps['view'] | undefined;
  dispose(): void;
} {
  const selection = createNativeSelectionDecoratorContext(theme);
  const releases = new Set<() => void>();
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let alive = true;
  const current = () =>
    alive &&
    view &&
    generation !== null &&
    view.mirror.keyGeneration === generation
      ? view
      : undefined;
  return {
    theme,
    current,
    host: {
      isSelected: selection.host.isSelected,
      registerNormalEnter(listener) {
        const mounted = current();
        if (!mounted?.port.nativeEnter)
          throw new Error(
            'Decorator requires the real native Normal Enter slot'
          );
        const Keyboard = mounted.root.ownerDocument.defaultView?.KeyboardEvent;
        const command = createViewCommand(
          'Key(Enter)',
          (value): value is KeyboardEvent | null =>
            value === null ||
            (Keyboard !== undefined && value instanceof Keyboard)
        );
        const release = mounted.registerViewCommand(
          command,
          (event) => {
            if (current() !== mounted) return false;
            return listener(event);
          },
          2
        );
        releases.add(release);
        return () => {
          releases.delete(release);
          release();
        };
      },
    },
    bindView(incoming) {
      selection.bindView(incoming);
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      alive = false;
      for (const release of releases) release();
      releases.clear();
      selection.dispose();
      view = undefined;
      generation = null;
    },
  };
}

/** Resolve a Source string key to the bound view's node of one decorator type. */
export function nativeDecoratorTarget(
  view: DecoratorProps['view'] | undefined,
  key: string,
  type: string
) {
  const index = Number(key);
  if (
    !view ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    String(index) !== key
  )
    return undefined;
  const node = view.node(index);
  return node?.type === type ? node : undefined;
}
