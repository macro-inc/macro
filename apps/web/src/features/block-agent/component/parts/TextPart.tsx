/** Prose from the user or the agent, rendered as static markdown. */

import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';

/**
 * Hide a trailing unclosed Macro mention tag so streaming text does not
 * flash raw `<m-document-mention>` XML. Complete tags stay intact.
 */
export function hideIncompleteMacroXml(text: string): string {
  const open = text.lastIndexOf('<m-');
  if (open === -1) return text;
  const after = text.slice(open);
  if (/^<m-[a-zA-Z0-9_-]+>[\s\S]*<\/m-[a-zA-Z0-9_-]+>/.test(after)) {
    return text;
  }
  return text.slice(0, open);
}

export function TextPart(props: { text: string; inFlight?: boolean }) {
  const markdown = () =>
    props.inFlight ? hideIncompleteMacroXml(props.text) : props.text;

  return (
    <div class="whitespace-pre-wrap wrap-break-word max-w-full text-sm">
      <StaticMarkdown
        markdown={markdown()}
        theme={channelTheme}
        target="internal"
      />
    </div>
  );
}
