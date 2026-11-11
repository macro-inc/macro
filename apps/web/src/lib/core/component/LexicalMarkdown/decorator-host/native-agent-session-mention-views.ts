import {
  type AgentSessionMentionDecoratorProps,
  AgentSessionMentionNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import type {
  AgentSessionMentionHost,
  AgentSessionMentionHostProp,
} from './agent-session-mention-host';
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
    'agent-session-mention': bind<
      AgentSessionMentionDecoratorProps & AgentSessionMentionHostProp
    >(AgentSessionMentionNode, (node, context) => {
      const value = node.props();
      if (
        typeof value.id !== 'string' ||
        (value.label != null && typeof value.label !== 'string') ||
        (value.mentionUuid != null && typeof value.mentionUuid !== 'string') ||
        (value.expanded != null && typeof value.expanded !== 'boolean')
      )
        throw new Error('Invalid agent session mention payload');
      return {
        id: value.id,
        label: value.label ?? undefined,
        mentionUuid: value.mentionUuid ?? undefined,
        // Source exportComponentProps includes expanded only when true.
        ...(value.expanded === true ? { expanded: true } : {}),
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
  };
}
