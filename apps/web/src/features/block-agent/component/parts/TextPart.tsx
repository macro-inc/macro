/** Prose from the user or the agent, rendered as static markdown. */

import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { createMemo, onCleanup, onMount } from 'solid-js';
import { hideIncompleteMacroXml } from './hideIncompleteMacroXml';

export function TextPart(props: {
  text: string;
  inFlight?: boolean;
  observeRender?: (element: HTMLElement) => (() => void) | undefined;
}) {
  // Memoized so an `inFlight` flip that leaves the text unchanged does not
  // rebuild the markdown DOM and reload its images.
  const markdown = createMemo(() =>
    props.inFlight ? hideIncompleteMacroXml(props.text) : props.text
  );
  let content!: HTMLDivElement;
  onMount(() => {
    const stop = props.observeRender?.(content);
    if (stop) onCleanup(stop);
  });

  return (
    // `chat-markdown-container` is the overflow host for KaTeX display math
    // (see index.css).
    <div
      ref={content}
      class="chat-markdown-container whitespace-pre-wrap wrap-break-word max-w-full text-base"
    >
      <StaticMarkdown
        markdown={markdown()}
        theme={channelTheme}
        target="internal"
        // Keep resolved mentions visible across stream reparses and completion.
        lazy={false}
      />
    </div>
  );
}
