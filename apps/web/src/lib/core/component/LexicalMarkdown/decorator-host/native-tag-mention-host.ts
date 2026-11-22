import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { NativeDecoratorContext } from './native-adapter';
import {
  createNativeEnterDecoratorContext,
  nativeDecoratorTarget,
} from './native-enter-host';
import type { TagMentionHost } from './tag-mention-host';

/** Tag info refresh goes through group-b.tag-info, admitted against current session access. */
export function createNativeTagMentionContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<TagMentionHost> & { dispose(): void } {
  const base = createNativeEnterDecoratorContext(theme);
  return {
    theme,
    host: {
      ...base.host,
      setTagInfo(key, info) {
        const mounted = base.current();
        const node = nativeDecoratorTarget(mounted, key, 'tag-mention');
        if (!mounted || !node) return;
        dispatchApplicationCommandIfSessionEdit(mounted, 'group-b.tag-info', {
          key: node.key,
          propertyDefinitionId: info.propertyDefinitionId,
          scope: info.scope,
          name: info.name,
          ...(info.color === undefined ? {} : { color: info.color }),
        });
      },
    },
    bindView: base.bindView,
    dispose: base.dispose,
  };
}
