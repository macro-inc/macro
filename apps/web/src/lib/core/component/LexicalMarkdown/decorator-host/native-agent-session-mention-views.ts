import { AgentSessionMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { AgentSessionMentionUIProps } from '../component/decorator/AgentSessionMention';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import type { AgentSessionMentionHost } from './agent-session-mention-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

/** Project the native agent-session payload into the registered component props. */
export function createNativeAgentSessionMentionViews<
  Host extends DecoratorHostCapabilities & AgentSessionMentionHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<MacroDecorators, 'agent-session-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'agent-session-mention': bind<AgentSessionMentionUIProps>(
      AgentSessionMentionNode,
      (node, context) => {
        const { id, label, mentionUuid, expanded } = node.props();
        // Source passes a stored null or omitted label and mention id through.
        // A null or missing id is a recorded gap: Source renders it, but the
        // preview query and routes it feeds are typed text outside the editor.
        if (
          typeof id !== 'string' ||
          (label != null && typeof label !== 'string') ||
          (mentionUuid != null && typeof mentionUuid !== 'string') ||
          (expanded != null && typeof expanded !== 'boolean')
        )
          throw new Error('Invalid agent session mention payload');
        return {
          id,
          label,
          mentionUuid,
          // Source exportComponentProps includes expanded only when true.
          ...(expanded === true ? { expanded } : {}),
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
