import {
  type AgentActivityDecoratorProps,
  AgentActivityNode,
  isAgentActivityData,
  isMagicChipMessage,
  isMagicChipStatus,
  MagicChipNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { MagicChipUIData } from '../component/decorator/MagicChip/types';
import type { MagicChipHost, MagicChipHostProp } from './magic-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

/** The consuming view owns signature observation and component lifetime. */
export function createNativeFastCachedDecoratorViews<
  Host extends MagicChipHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<MacroDecorators, 'magic-chip' | 'agent-activity'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'agent-activity': bind<AgentActivityDecoratorProps>(
      AgentActivityNode,
      (node, context) => {
        const value = node.props();
        if (!isAgentActivityData(value))
          throw new Error('Invalid agent activity payload');
        return { ...value, key: String(node.key), theme: context.theme };
      }
    ),
    'magic-chip': bind<MagicChipUIData & MagicChipHostProp & { key: string }>(
      MagicChipNode,
      (node, context) => {
        const value = node.props();
        const message = value.promptedMessage;
        if (
          typeof value.agentSessionId !== 'string' ||
          (value.channelId !== undefined &&
            value.channelId !== null &&
            typeof value.channelId !== 'string') ||
          !isMagicChipStatus(value.status) ||
          (message !== null &&
            !Array.isArray(message) &&
            !isMagicChipMessage(message))
        )
          throw new Error('Invalid magic chip payload');
        return {
          agentSessionId: value.agentSessionId,
          ...(value.channelId === undefined
            ? {}
            : { channelId: value.channelId }),
          promptedMessage: message,
          status: value.status,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
