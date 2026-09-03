/** Prose from the user or the agent, rendered as static markdown. */

import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';

export function TextPart(props: { text: string }) {
  return (
    // `chat-markdown-container` is the overflow host for KaTeX display math
    // (see index.css).
    <div class="chat-markdown-container whitespace-pre-wrap wrap-break-word max-w-full text-sm">
      <StaticMarkdown
        markdown={props.text}
        theme={channelTheme}
        target="internal"
      />
    </div>
  );
}
