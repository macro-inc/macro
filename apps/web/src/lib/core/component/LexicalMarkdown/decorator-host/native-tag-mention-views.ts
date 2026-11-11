import {
  type TagMentionDecoratorProps,
  TagMentionNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';
import type { TagMentionHost, TagMentionHostProp } from './tag-mention-host';

/** Project the native tag-mention payload into the registered TagMention props. */
export function createNativeTagMentionViews<
  Host extends DecoratorHostCapabilities & TagMentionHost,
>(context: NativeDecoratorContext<Host>): Pick<MacroDecorators, 'tag-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'tag-mention': bind<TagMentionDecoratorProps & TagMentionHostProp>(
      TagMentionNode,
      (node, context) => {
        const value = node.props();
        if (
          typeof value.optionId !== 'string' ||
          typeof value.propertyDefinitionId !== 'string' ||
          (value.scope !== 'user' && value.scope !== 'team') ||
          typeof value.name !== 'string' ||
          (value.color !== undefined &&
            value.color !== null &&
            typeof value.color !== 'string')
        )
          throw new Error('Invalid tag mention payload');
        return {
          optionId: value.optionId,
          propertyDefinitionId: value.propertyDefinitionId,
          scope: value.scope,
          name: value.name,
          color: typeof value.color === 'string' ? value.color : undefined,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
