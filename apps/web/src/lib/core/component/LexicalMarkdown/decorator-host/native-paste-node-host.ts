import type { EditorThemeClasses } from 'lexical';
import { createSignal } from 'solid-js';
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
  // The view turns editable after decorators mount; publish it so the
  // actions menu appears (Source reads editability once, an OFF bug kept out).
  const [editable, setEditable] = createSignal(false);
  let releaseEditable: (() => void) | undefined;
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
      isEditable: () => editable() && base.current() !== undefined,
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
    bindView(view) {
      base.bindView(view);
      if (releaseEditable) return;
      setEditable(view.isEditable);
      releaseEditable = view.onEditableChange(setEditable);
    },
    dispose() {
      releaseEditable?.();
      releaseEditable = undefined;
      setEditable(false);
      base.dispose();
    },
  };
}
