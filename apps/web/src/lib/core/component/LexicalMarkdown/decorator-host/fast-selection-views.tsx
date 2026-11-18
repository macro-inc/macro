import {
  type ConnectAppDecoratorProps,
  ConnectAppNode,
  GroupMentionNode,
  ThemeMentionNode,
  UnknownMentionNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type {
  JsonObject,
  JsonValue,
} from '@macro-inc/lexical-wasm-view/view/types';
import type { GroupMentionUIProps } from '../component/decorator/GroupMention';
import type { ThemeMentionUIProps } from '../component/decorator/ThemeMention';
import type { UnknownMentionUIProps } from '../component/decorator/UnknownMention';
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
    'group-mention': bind<GroupMentionUIProps>(
      GroupMentionNode,
      (node, context) => {
        const groupAlias = node.props().groupAlias;
        // Source keeps a stored null or omitted alias and renders a bare `@`.
        if (
          groupAlias !== undefined &&
          groupAlias !== null &&
          typeof groupAlias !== 'string'
        )
          throw new Error('Invalid group alias');
        return {
          groupAlias,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
    'unknown-mention': bind<UnknownMentionUIProps>(
      UnknownMentionNode,
      (node, context) => {
        const name = node.props().name;
        // Source keeps a stored null or omitted name and renders "Unknown".
        if (name !== undefined && name !== null && typeof name !== 'string')
          throw new Error('Invalid unknown mention name');
        return {
          name,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
    'theme-mention': bind<ThemeMentionUIProps>(
      ThemeMentionNode,
      (node, context) => {
        const { name, data } = node.props();
        // Source keeps a stored null or omitted data and renders only the name.
        if (
          typeof name !== 'string' ||
          (data !== undefined && data !== null && !isObject(data))
        )
          throw new Error('Invalid theme mention payload');
        return {
          name,
          data,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
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
