/** Prose from the user or the agent, rendered as static markdown. */

import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { hideIncompleteMacroXml } from './hideIncompleteMacroXml';

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
