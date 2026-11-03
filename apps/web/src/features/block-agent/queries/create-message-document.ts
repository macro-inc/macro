/**
 * Saves an agent reply as a markdown document. Citations become the same
 * mention chips a document renders.
 */

import { replaceCitations } from '@core/component/LexicalMarkdown/citationsUtils';
import { createMarkdownFile } from '@core/util/create';

export async function createDocumentFromReply(args: {
  title: string;
  markdown: string;
}): Promise<string | undefined> {
  const content = await replaceCitations(args.markdown);
  return createMarkdownFile({
    content,
    title: args.title,
    source: 'agent-message',
  });
}
