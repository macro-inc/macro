import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import type { ContactMentionHost } from './contact-host';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

/** Published UI selection and the actual native Normal-priority Enter slot. */
export function createNativeContactContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<ContactMentionHost> & { dispose(): void } {
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
    host: {
      isSelected: selection.host.isSelected,
      registerNormalEnter(listener) {
        const mounted = current();
        if (!mounted?.port.nativeEnter)
          throw new Error('Contact requires the real native Normal Enter slot');
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
