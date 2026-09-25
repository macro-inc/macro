import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { isEmojiOnly } from '@core/util/string';
import { cn } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { splitMessageContent } from './agent-session-link';
import { useMessage, useSearchHighlightTermsLookup } from './context';
import { createSearchHighlightOverlay } from './highlightOverlay';

type ContentProps = {
  class?: string;
};

export function Content(props: ContentProps) {
  const message = useMessage();
  const termsLookup = useSearchHighlightTermsLookup();

  // The body only: an agent message's leading session node is chrome the
  // sender line renders (`Message.AgentSessionLink`), not part of the text.
  const content = createMemo(() => splitMessageContent(message()).body);
  const bigEmoji = createMemo(() => isEmojiOnly(content()));
  const terms = createMemo(() => termsLookup?.(message().id));

  const [markdownRoot, setMarkdownRoot] = createSignal<HTMLDivElement>();

  createSearchHighlightOverlay({ root: markdownRoot, content, terms });

  return (
    <Show when={content()}>
      <div
        data-message-content
        class={cn(
          'whitespace-pre-wrap wrap-break-word max-w-full',
          bigEmoji() ? 'text-4xl' : 'text-base',
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
