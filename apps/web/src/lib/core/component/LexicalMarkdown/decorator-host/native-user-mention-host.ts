import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';
import type { UserMentionHost } from './user-mention-host';

/** One surface-owned context, bound to its actual acknowledged view generation. */
export function createNativeUserMentionContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<UserMentionHost> & { dispose(): void } {
  const selection = createNativeSelectionDecoratorContext(theme);
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let alive = true;
  return {
    theme,
    host: {
      isSelected: selection.host.isSelected,
      updateUserDisplayName(userId, displayName) {
        if (
          !alive ||
          !view ||
          generation === null ||
          view.mirror.keyGeneration !== generation
        )
          return;
        dispatchApplicationCommandIfSessionEdit(
          view,
          'group-b.user-display-names',
          {
            names: { [userId]: displayName },
          }
        );
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
