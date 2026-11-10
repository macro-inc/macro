import {
  type ConnectAppDecoratorProps,
  ConnectAppNode,
  type GroupMentionDecoratorProps,
  GroupMentionNode,
  type ThemeMentionDecoratorProps,
  ThemeMentionNode,
  type UnknownMentionDecoratorProps,
  UnknownMentionNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type {
  JsonObject,
  JsonValue,
} from '@macro-inc/lexical-wasm-view/view/types';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';
import type {
  DecoratorSelectionHost,
  DecoratorSelectionHostProp,
} from './selection-host';

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The shared adapter owns rendering; each row only projects actual Source props. */
export function createNativeFastSelectionDecoratorViews<
  Host extends DecoratorHostCapabilities & DecoratorSelectionHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<
  MacroDecorators,
  'group-mention' | 'unknown-mention' | 'theme-mention' | 'connect-app'
> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'group-mention': bind<
      GroupMentionDecoratorProps & DecoratorSelectionHostProp
    >(GroupMentionNode, (node, context) => {
      const value = node.props().groupAlias;
      if (typeof value !== 'string') throw new Error('Invalid group alias');
      return {
        groupAlias: value,
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
    'unknown-mention': bind<
      UnknownMentionDecoratorProps & DecoratorSelectionHostProp
    >(UnknownMentionNode, (node, context) => {
      const value = node.props().name;
      if (typeof value !== 'string')
        throw new Error('Invalid unknown mention name');
      return {
        name: value,
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
    'theme-mention': bind<
      ThemeMentionDecoratorProps & DecoratorSelectionHostProp
    >(ThemeMentionNode, (node, context) => {
      const value = node.props();
      if (typeof value.name !== 'string' || !isObject(value.data))
        throw new Error('Invalid theme mention payload');
      return {
        name: value.name,
        data: value.data,
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
    'connect-app': bind<ConnectAppDecoratorProps & DecoratorSelectionHostProp>(
      ConnectAppNode,
      (node, context) => {
        const value = node.props();
        if (
          typeof value.name !== 'string' ||
          typeof value.appSlug !== 'string' ||
          (value.target !== 'harness' && value.target !== 'connections')
        )
          throw new Error('Invalid connect app payload');
        return {
          name: value.name,
          appSlug: value.appSlug,
          target: value.target,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
