import {
  type AccountManagerRequestDecoratorProps,
  AccountManagerRequestNode,
  type AgentContextDecoratorProps,
  AgentContextNode,
  type AwaitDecoratorProps,
  AwaitNode,
  type CursorSystemNotificationDecoratorProps,
  CursorSystemNotificationNode,
  type ReplyTargetDecoratorProps,
  ReplyTargetNode,
  type ReplyTargetParent,
  type WatermarkDecoratorProps,
  WatermarkNode,
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

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isReplyParentType(
  value: JsonValue | undefined
): value is ReplyTargetParent['type'] {
  return (
    value === 'channel' ||
    value === 'document' ||
    value === 'initiative' ||
    value === 'crm_company' ||
    value === 'crm_contact' ||
    value === 'call'
  );
}

/** Rows project actual props through the common initialized-component adapter. */
export function createNativeFastStaticDecoratorViews<
  Host extends DecoratorHostCapabilities,
>(
  context: NativeDecoratorContext<Host>
): Pick<
  MacroDecorators,
  | 'watermark'
  | 'await'
  | 'agent-context'
  | 'reply-target'
  | 'account-manager-request'
  | 'system-notification'
> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'reply-target': bind<ReplyTargetDecoratorProps>(
      ReplyTargetNode,
      (node, context) => {
        const value = node.props();
        if (
          !isObject(value.parent) ||
          !isReplyParentType(value.parent.type) ||
          typeof value.parent.id !== 'string' ||
          typeof value.targetMessageId !== 'string' ||
          typeof value.targetThreadId !== 'string' ||
          typeof value.displayText !== 'string' ||
          typeof value.senderId !== 'string'
        )
          throw new Error('Invalid reply target payload');
        return {
          parent: {
            ...value.parent,
            type: value.parent.type,
            id: value.parent.id,
          },
          targetMessageId: value.targetMessageId,
          targetThreadId: value.targetThreadId,
          displayText: value.displayText,
          senderId: value.senderId,
          key: String(node.key),
          theme: context.theme,
        };
      }
    ),
    'account-manager-request': bind<AccountManagerRequestDecoratorProps>(
      AccountManagerRequestNode,
      (node, context) => {
        const grantId = node.props().grantId;
        if (typeof grantId !== 'string')
          throw new Error('Invalid account manager request payload');
        return { grantId, key: String(node.key), theme: context.theme };
      }
    ),
    'system-notification': bind<CursorSystemNotificationDecoratorProps>(
      CursorSystemNotificationNode,
      (node, context) => {
        const value = node.props();
        if (
          typeof value.source !== 'string' ||
          typeof value.text !== 'string' ||
          !isObject(value.attributes)
        )
          throw new Error('Invalid system notification payload');
        const entries: [string, string][] = [];
        for (const [key, attribute] of Object.entries(value.attributes)) {
          if (typeof attribute !== 'string')
            throw new Error('Invalid system notification attribute');
          entries.push([key, attribute]);
        }
        return {
          source: value.source,
          attributes: Object.fromEntries(entries),
          text: value.text,
          key: String(node.key),
          theme: context.theme,
        };
      }
    ),
    watermark: bind<WatermarkDecoratorProps>(WatermarkNode, (node, context) => {
      const content = node.props().content;
      if (typeof content !== 'string')
        throw new Error('Invalid watermark content');
      return { content, key: String(node.key), theme: context.theme };
    }),
    await: bind<AwaitDecoratorProps>(AwaitNode, (node, context) => {
      const value = node.props();
      if (
        typeof value.awaitId !== 'string' ||
        (value.text !== undefined && typeof value.text !== 'string') ||
        typeof value.inline !== 'boolean'
      )
        throw new Error('Invalid await payload');
      return {
        awaitId: value.awaitId,
        text: value.text,
        inline: value.inline,
        key: String(node.key),
        theme: context.theme,
      };
    }),
    'agent-context': bind<AgentContextDecoratorProps>(
      AgentContextNode,
      (node, context) => {
        const text = node.props().text;
        if (typeof text !== 'string')
          throw new Error('Invalid agent context text');
        return {
          version: 1,
          text,
          key: String(node.key),
          theme: context.theme,
        };
      }
    ),
  };
}
