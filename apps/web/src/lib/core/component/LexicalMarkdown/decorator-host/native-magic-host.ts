import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import type { MagicChipHost } from './magic-host';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

/** The surface supplies its real document kind; the native preset does not imply it. */
export function createNativeMagicDecoratorContext(
  theme: EditorThemeClasses,
  documentKind: 'markdown' | 'markdown-sync' | 'other'
): NativeDecoratorContext<MagicChipHost> & { dispose(): void } {
  const selection = createNativeSelectionDecoratorContext(theme);
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let alive = true;
  const live = () =>
    alive && view !== undefined && generation === view.mirror.keyGeneration;
  return {
    theme,
    host: {
      isSelected: selection.host.isSelected,
      isDocument: () => documentKind !== 'other',
      isEditable: () => live() && view?.root.contentEditable === 'true',
      selectNode(sourceKey) {
        if (!live() || !view || view.root.contentEditable !== 'true') return;
        const key = Number(sourceKey);
        if (
          !Number.isSafeInteger(key) ||
          String(key) !== sourceKey ||
          !view.node(key) ||
          !view.getElementByKey(key)
        )
          return;
        view.port.selectionFromView({ kind: 'node', keys: [key] });
      },
    },
    bindView(incoming) {
      selection.bindView(incoming);
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      alive = false;
      selection.dispose();
      view = undefined;
      generation = null;
    },
  };
}
