import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { DateMentionHost } from './date-mention-host';
import type { NativeDecoratorContext } from './native-adapter';
import {
  createNativeEnterDecoratorContext,
  nativeDecoratorTarget,
} from './native-enter-host';

/** Picker edits go through group-b.date-mention, admitted against current session access. */
export function createNativeDateMentionContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<DateMentionHost> & { dispose(): void } {
  const base = createNativeEnterDecoratorContext(theme);
  const releases = new Set<() => void>();
  return {
    theme,
    host: {
      ...base.host,
      registerUpdateListener(listener) {
        const mounted = base.current();
        if (!mounted) throw new Error('Date mention requires a bound view');
        // Source update listeners skip updates with no dirty nodes or selection.
        const release = mounted.onCommit((info) => {
          if (
            base.current() === mounted &&
            (info.fullReconcile ||
              info.selectionChanged ||
              info.keys.length > 0 ||
              info.mutations.size > 0)
          )
            listener();
        });
        releases.add(release);
        return () => {
          releases.delete(release);
          release();
        };
      },
      setDate(key, date, displayFormat) {
        const mounted = base.current();
        const node = nativeDecoratorTarget(mounted, key, 'date-mention');
        if (!mounted || !node) return;
        dispatchApplicationCommandIfSessionEdit(
          mounted,
          'group-b.date-mention',
          { key: node.key, date, displayFormat }
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
