import { UserMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { JsonObject } from '@macro-inc/lexical-wasm-view/view/types';
import type { UserMentionProps } from '../component/decorator/UserMention';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';
import type { UserMentionHost } from './user-mention-host';

function nullableString(
  props: JsonObject,
  name: string
): string | null | undefined {
  const value = props[name];
  if (value === null || value === undefined || typeof value === 'string')
    return value;
  throw new Error(`Invalid native user mention ${name}`);
}
function optionalString(props: JsonObject, name: string): string | undefined {
  const value = props[name];
  if (value === undefined || typeof value === 'string') return value;
  throw new Error(`Invalid native user mention ${name}`);
}

/** Actual initialized Source component, without constructing a JS model node. */
export function createNativeUserMentionViews(
  context: NativeDecoratorContext<UserMentionHost>
): Pick<MacroDecorators, 'user-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'user-mention': bind<UserMentionProps>(UserMentionNode, (node, context) => {
      const data = node.props();
      return {
        key: String(node.key),
        theme: context.theme,
        userId: nullableString(data, 'userId'),
        email: nullableString(data, 'email'),
        displayName: optionalString(data, 'displayName'),
        mentionUuid: nullableString(data, 'mentionUuid'),
      };
    }),
  };
}
