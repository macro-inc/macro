import {
  type AgentActivityDecoratorProps,
  AgentActivityNode,
  isAgentActivityData,
  MagicChipNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { MagicChipUIData } from '../component/decorator/MagicChip/types';
import type { MagicChipHost, MagicChipHostProp } from './magic-host';
import { projectMagicChipData } from './magic-projection';
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
        return {
          ...projectMagicChipData(node.props()),
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
