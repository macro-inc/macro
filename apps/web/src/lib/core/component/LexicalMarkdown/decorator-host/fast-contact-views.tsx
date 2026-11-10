import {
  type ContactMentionDecoratorProps,
  type ContactMentionInfo,
  ContactMentionNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import type {
  ContactMentionHost,
  ContactMentionHostProp,
} from './contact-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

/** The view owner supplies a real Normal Enter host; no model node is constructed. */
export function createNativeFastContactDecoratorViews<
  Host extends DecoratorHostCapabilities & ContactMentionHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<MacroDecorators, 'contact-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'contact-mention': bind<
      ContactMentionInfo & ContactMentionDecoratorProps & ContactMentionHostProp
    >(ContactMentionNode, (node, context) => {
      const value = node.props();
      if (
        typeof value.contactId !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.emailOrDomain !== 'string' ||
        typeof value.isCompany !== 'boolean' ||
        (value.mentionUuid !== undefined &&
          typeof value.mentionUuid !== 'string')
      )
        throw new Error('Invalid contact mention payload');
      return {
        contactId: value.contactId,
        name: value.name,
        emailOrDomain: value.emailOrDomain,
        isCompany: value.isCompany,
        mentionUuid: value.mentionUuid,
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
  };
}
