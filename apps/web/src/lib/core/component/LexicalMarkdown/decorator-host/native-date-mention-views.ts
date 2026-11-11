import {
  type DateMentionDecoratorProps,
  type DateMentionInfo,
  DateMentionNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import type { DateMentionHost, DateMentionHostProp } from './date-mention-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

/** Project the native date-mention payload into the registered DateMention props. */
export function createNativeDateMentionViews<
  Host extends DecoratorHostCapabilities & DateMentionHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<MacroDecorators, 'date-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'date-mention': bind<
      DateMentionInfo & DateMentionDecoratorProps & DateMentionHostProp
    >(DateMentionNode, (node, context) => {
      const value = node.props();
      if (
        typeof value.date !== 'string' ||
        typeof value.displayFormat !== 'string' ||
        (value.mentionUuid != null && typeof value.mentionUuid !== 'string')
      )
        throw new Error('Invalid date mention payload');
      return {
        date: value.date,
        displayFormat: value.displayFormat,
        // Stored documents carry mentionUuid: null when it was never set.
        mentionUuid: value.mentionUuid ?? undefined,
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
    }),
  };
}
