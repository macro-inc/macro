import { TagMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { TagMentionUIProps } from '../component/decorator/TagMention';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';
import type { TagMentionHost } from './tag-mention-host';

/** Project the native tag-mention payload into the registered TagMention props. */
export function createNativeTagMentionViews<
  Host extends DecoratorHostCapabilities & TagMentionHost,
>(context: NativeDecoratorContext<Host>): Pick<MacroDecorators, 'tag-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'tag-mention': bind<TagMentionUIProps>(TagMentionNode, (node, context) => {
      const { optionId, propertyDefinitionId, scope, name, color } =
        node.props();
      // Source fails the whole document on a null or missing name; null ids
      // are a recorded gap (opening the tag needs text ids).
      if (
        typeof optionId !== 'string' ||
        typeof propertyDefinitionId !== 'string' ||
        (scope !== 'user' && scope !== 'team') ||
        typeof name !== 'string' ||
        (color !== undefined && color !== null && typeof color !== 'string')
      )
        throw new Error('Invalid tag mention payload');
      return {
        optionId,
        propertyDefinitionId,
        scope,
        name,
        // Source hands a stored null color over unchanged.
        color,
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
  };
}
