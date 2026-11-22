import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { AgentSessionMentionHost } from './agent-session-mention-host';
import type { NativeDecoratorContext } from './native-adapter';
import {
  createNativeEnterDecoratorContext,
  nativeDecoratorTarget,
} from './native-enter-host';
import { createNativeMagicDecoratorContext } from './native-magic-host';

/** Expand, collapse and first-mount normalization go through admitted Group B actions. */
export function createNativeAgentSessionMentionContext(
  theme: EditorThemeClasses,
  isInteractable: () => boolean
): NativeDecoratorContext<AgentSessionMentionHost> & { dispose(): void } {
  const base = createNativeEnterDecoratorContext(theme);
  const magic = createNativeMagicDecoratorContext(theme, 'markdown-sync');
  const dispatch = (
    key: string,
    name: string,
    payload: { expanded?: boolean }
  ) => {
    const mounted = base.current();
    const node = nativeDecoratorTarget(mounted, key, 'agent-session-mention');
    if (!mounted || !node) return;
    dispatchApplicationCommandIfSessionEdit(mounted, name, {
      key: node.key,
      ...payload,
    });
  };
  return {
    theme,
    host: {
      ...base.host,
      previewFetchEnabled: () => true,
      isInteractable,
      setExpanded(key, expanded) {
        dispatch(key, 'group-b.agent-session-expanded', { expanded });
      },
      normalize(key) {
        dispatch(key, 'group-b.agent-session-normalize', {});
      },
      magic: magic.host,
    },
    bindView(view) {
      base.bindView(view);
      magic.bindView(view);
    },
    dispose() {
      magic.dispose();
      base.dispose();
    },
  };
}
