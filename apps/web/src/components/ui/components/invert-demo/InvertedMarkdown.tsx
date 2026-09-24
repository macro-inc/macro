import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import markdown from './inverted-markdown.md?raw';

export default function InvertedMarkdown() {
  return (
    <StaticMarkdownContext lazy={false}>
      <StaticMarkdown markdown={markdown} />
    </StaticMarkdownContext>
  );
}
