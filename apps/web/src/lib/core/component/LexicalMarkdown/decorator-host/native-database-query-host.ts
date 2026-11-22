import type { DatabaseQueryData } from '@macro-inc/lexical-core/nodes/databaseQueryData';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { DatabaseQueryHost } from './database-query-host';
import type { NativeDecoratorContext } from './native-adapter';
import {
  createNativeEnterDecoratorContext,
  nativeDecoratorTarget,
} from './native-enter-host';

/** Answer edits go through the existing group-b.database-query-save/-discard actions. */
export function createNativeDatabaseQueryContext(
  theme: EditorThemeClasses,
  isInteractable: () => boolean
): NativeDecoratorContext<DatabaseQueryHost> & { dispose(): void } {
  const base = createNativeEnterDecoratorContext(theme);
  const releases = new Set<() => void>();
  const target = (key: string) => {
    const mounted = base.current();
    const node = nativeDecoratorTarget(mounted, key, 'database-query');
    return mounted && node ? { mounted, node } : undefined;
  };
  return {
    theme,
    host: {
      isSelected: base.host.isSelected,
      isEditable: () => base.current()?.isEditable ?? false,
      registerEditableListener(listener) {
        const mounted = base.current();
        if (!mounted) throw new Error('Database query requires a bound view');
        const release = mounted.onEditableChange((editable) => {
          if (base.current() === mounted) listener(editable);
        });
        releases.add(release);
        return () => {
          releases.delete(release);
          release();
        };
      },
      isInteractable,
      previewFetchEnabled: () => true,
      selectBlock(key) {
        const found = target(key);
        if (!found) return;
        const { mounted, node } = found;
        const root = mounted.root;
        if (root.ownerDocument.activeElement !== root)
          root.focus({ preventScroll: true });
        const current = mounted.selection().selection;
        if (
          current.kind === 'node' &&
          current.keys.length === 1 &&
          current.keys[0] === node.key
        )
          return;
        mounted.port.selectionFromView({ kind: 'node', keys: [node.key] });
      },
      save(key, data: DatabaseQueryData) {
        const found = target(key);
        if (!found) return;
        // DatabaseQueryData is plain JSON; the native decoder validates it.
        const payload: JsonValue = JSON.parse(JSON.stringify(data));
        dispatchApplicationCommandIfSessionEdit(
          found.mounted,
          'group-b.database-query-save',
          { key: found.node.key, data: payload }
        );
      },
      discard(key) {
        const found = target(key);
        if (!found) return;
        dispatchApplicationCommandIfSessionEdit(
          found.mounted,
          'group-b.database-query-discard',
          { key: found.node.key }
        );
      },
    },
    bindView: base.bindView,
    dispose() {
      for (const release of releases) release();
      releases.clear();
      base.dispose();
    },
  };
}
