import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import type { WidgetOf } from '../schema';

export type MdProps = Omit<WidgetOf<'md'>, 'type'>;

/**
 * Renders static markdown via the app's Lexical static renderer. For best
 * results (and to avoid a per-instance editor), render inside a
 * <StaticMarkdownContext> — the gallery/ComposeView provides one.
 */
export function Md(props: MdProps) {
  return (
    <StaticMarkdown
      markdown={props.markdown}
      theme={aiChatTheme}
      target="internal"
    />
  );
}
