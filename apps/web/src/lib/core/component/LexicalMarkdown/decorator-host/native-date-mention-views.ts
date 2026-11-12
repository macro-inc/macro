import { DateMentionNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import type { DateMentionUIProps } from '../component/decorator/DateMention';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import type { DateMentionHost } from './date-mention-host';
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

/** Project the native date-mention payload into the registered DateMention props. */
export function createNativeDateMentionViews<
  Host extends DecoratorHostCapabilities & DateMentionHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<MacroDecorators, 'date-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'date-mention': bind<DateMentionUIProps>(
      DateMentionNode,
      (node, context) => {
        const { date, displayFormat, mentionUuid } = node.props();
        if (
          !isStoredText(date) ||
          !isStoredText(displayFormat) ||
          !isStoredText(mentionUuid)
        )
          throw new Error('Invalid date mention payload');
        return {
          date,
          displayFormat,
          mentionUuid,
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
