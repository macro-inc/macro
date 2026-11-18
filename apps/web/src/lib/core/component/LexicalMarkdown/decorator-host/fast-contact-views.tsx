import { ContactMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import type { ContactMentionUIProps } from '../component/decorator/ContactMention';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import type { ContactMentionHost } from './contact-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

/** A stored text field Source passes through: a string, an explicit null, or omitted. */
function isStoredText(
  value: JsonValue | undefined
): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

/** The view owner supplies a real Normal Enter host; no model node is constructed. */
export function createNativeFastContactDecoratorViews<
  Host extends DecoratorHostCapabilities & ContactMentionHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<MacroDecorators, 'contact-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'contact-mention': bind<ContactMentionUIProps>(
      ContactMentionNode,
      (node, context) => {
        const { contactId, name, emailOrDomain, isCompany, mentionUuid } =
          node.props();
        if (
          !isStoredText(contactId) ||
          !isStoredText(emailOrDomain) ||
          !isStoredText(mentionUuid)
        )
          throw new Error('Invalid contact mention payload');
        const stored = {
          contactId,
          emailOrDomain,
          mentionUuid,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
        // A company displays its domain; Source never reads its name as a string.
        if (isCompany === true) {
          if (!isStoredText(name))
            throw new Error('Invalid contact mention payload');
          return { ...stored, isCompany, name };
        }
        // Source trims a person's name, so only a string renders.
        if (
          (isCompany !== false &&
            isCompany !== null &&
            isCompany !== undefined) ||
          typeof name !== 'string'
        )
          throw new Error('Invalid contact mention payload');
        return { ...stored, isCompany, name };
      }
    ),
  };
}
