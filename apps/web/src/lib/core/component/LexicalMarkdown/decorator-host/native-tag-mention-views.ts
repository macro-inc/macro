import { TagMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import type { TagMentionUIProps } from '../component/decorator/TagMention';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';
import type { TagMentionHost } from './tag-mention-host';

/** A stored text field Source passes through: a string, an explicit null, or omitted. */
function isStoredText(
  value: JsonValue | undefined
): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

/** A stored scope Source passes through: user, team, an explicit null, or omitted. */
function isStoredScope(
  value: JsonValue | undefined
): value is TagMentionUIProps['scope'] {
  return (
    value === undefined ||
    value === null ||
    value === 'user' ||
    value === 'team'
  );
}

/** Project the native tag-mention payload into the registered TagMention props. */
export function createNativeTagMentionViews<
  Host extends DecoratorHostCapabilities & TagMentionHost,
>(context: NativeDecoratorContext<Host>): Pick<MacroDecorators, 'tag-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'tag-mention': bind<TagMentionUIProps>(TagMentionNode, (node, context) => {
      const { optionId, propertyDefinitionId, scope, name, color } =
        node.props();
      if (
        !isStoredText(optionId) ||
        !isStoredText(propertyDefinitionId) ||
        !isStoredScope(scope) ||
        !isStoredText(name) ||
        !isStoredText(color)
      )
        throw new Error('Invalid tag mention payload');
      return {
        optionId,
        propertyDefinitionId,
        scope,
        name,
        color,
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
  };
}
