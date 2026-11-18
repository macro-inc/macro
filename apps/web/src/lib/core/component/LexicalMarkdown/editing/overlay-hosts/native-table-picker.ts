import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import {
  insertNativeTable,
  registerNativeTablePicker,
} from '../../plugins/tables/native';
import { createNativeListenerScope } from './native-listeners';
import type { TablePickerHost } from './table-picker';

/** Bind the shared picker to the real view and its installation lifetime. */
export function createNativeTablePickerHost(
  view: Accessor<EditorView | undefined>
): TablePickerHost & { dispose(): void } {
  let disposed = false;
  const registrations = new Set<() => void>();
  return {
    root() {
      const current = view();
      return !disposed && current?.isMounted ? current.root : null;
    },
    focus() {
      const current = view();
      if (!disposed && current?.isMounted) current.focus();
    },
    insert(rows, columns) {
      const current = view();
      if (!disposed && current?.isMounted)
        insertNativeTable(current, rows, columns, false);
    },
    registerPicker(canEdit, onCreate) {
      if (disposed) return;
      createEffect(
        on([view, canEdit], ([current, editable]) => {
          if (disposed || !current?.isMounted || !editable) return;
          const remove = registerNativeTablePicker(current, () => {
            if (!disposed && canEdit()) onCreate();
          });
          let registered = true;
          const release = () => {
            if (!registered) return;
            registered = false;
            registrations.delete(release);
            remove();
          };
          registrations.add(release);
          onCleanup(release);
        })
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const closing = createNativeListenerScope();
      for (const release of registrations) closing.add(release);
      closing.dispose();
    },
  };
}
