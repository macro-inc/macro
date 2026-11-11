import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { NativeDecoratorContext } from './native-adapter';
import {
  createNativeEnterDecoratorContext,
  nativeDecoratorTarget,
} from './native-enter-host';
import type { PasteNodeHost } from './paste-node-host';

/** Convert and delete go through the existing group-b.paste-to-text and decorator-delete actions. */
export function createNativePasteNodeContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<PasteNodeHost> & { dispose(): void } {
  const base = createNativeEnterDecoratorContext(theme);
  const target = (key: string) => {
    const mounted = base.current();
    const node = nativeDecoratorTarget(mounted, key, 'paste');
    return mounted && node ? { mounted, node } : undefined;
  };
  const dispatch = (key: string, name: string) => {
    const found = target(key);
    if (found)
      dispatchApplicationCommandIfSessionEdit(found.mounted, name, {
        key: found.node.key,
      });
  };
  return {
    theme,
    host: {
      isSelected: base.host.isSelected,
      isEditable: () => base.current()?.isEditable ?? false,
      selectNode(key) {
        const found = target(key);
        if (!found?.mounted.isEditable) return;
        found.mounted.port.selectionFromView({
          kind: 'node',
          keys: [found.node.key],
        });
      },
      convertToText: (key) => dispatch(key, 'group-b.paste-to-text'),
      deleteNode: (key) => dispatch(key, 'group-b.decorator-delete'),
    },
    bindView: base.bindView,
    dispose: base.dispose,
  };
}
