import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { isEmojiOnly } from '@core/util/string';
import { cn } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { useMessage, useSearchHighlightTermsLookup } from './context';
import { createSearchHighlightOverlay } from './highlightOverlay';

type ContentProps = {
  class?: string;
};

export function Content(props: ContentProps) {
  const message = useMessage();
  const bigEmoji = createMemo(() => isEmojiOnly(message().content ?? ''));
  const termsLookup = useSearchHighlightTermsLookup();

  const content = createMemo(() => message().content ?? '');
  const terms = createMemo(() => termsLookup?.(message().id));

  const [markdownRoot, setMarkdownRoot] = createSignal<HTMLDivElement>();

  createSearchHighlightOverlay({ root: markdownRoot, content, terms });

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
          markdown={content()}
          theme={channelTheme}
          target="internal"
          rootRef={setMarkdownRoot}
        />
      </div>
    </Show>
  );
}
