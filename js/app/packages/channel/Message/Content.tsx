import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import {
  highlightTermsInText,
  mergeAdjacentMacroEmTags,
} from '@core/util/searchHighlight';
import { isEmojiOnly } from '@core/util/string';
import { cn } from '@ui';
import { createMemo, Show } from 'solid-js';
import { useMessage, useSearchHighlightTermsLookup } from './context';

type ContentProps = {
  class?: string;
};

export function Content(props: ContentProps) {
  const message = useMessage();
  const bigEmoji = createMemo(() => isEmojiOnly(message().content ?? ''));
  const termsLookup = useSearchHighlightTermsLookup();

  const renderedMarkdown = createMemo(() => {
    const raw = message().content ?? '';
    const terms = termsLookup?.(message().id);
    if (!terms?.length) return raw;
    return mergeAdjacentMacroEmTags(highlightTermsInText(raw, [...terms]));
  });

  return (
    <Show when={message().content}>
      <div
        class={cn(
          'whitespace-pre-wrap wrap-break-word max-w-full',
          bigEmoji() ? 'text-4xl' : 'text-sm',
          props.class
        )}
      >
        <StaticMarkdown
          markdown={renderedMarkdown()}
          theme={channelTheme}
          target="internal"
        />
      </div>
    </Show>
  );
}
