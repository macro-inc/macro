import { convertDocumentMentionsToLinks } from '@core/component/LexicalMarkdown/utils/convertDocumentMentionsToLinks';
import { $generateHtmlFromNodes } from '@lexical/html';
import type { LexicalEditor } from 'lexical';

/** Prepare exported editor HTML for calendar providers and invitation emails. */
export function prepareCalendarDescriptionFromHtml(
  generatedHtml: string
): string {
  const parsed = new DOMParser().parseFromString(generatedHtml, 'text/html');
  convertDocumentMentionsToLinks(parsed.body);
  return parsed.body.innerHTML;
}

/** Export all mention types as email-compatible HTML. */
export function prepareCalendarDescription(editor: LexicalEditor): string {
  const generatedHtml = editor.read(() => $generateHtmlFromNodes(editor));
  return prepareCalendarDescriptionFromHtml(generatedHtml);
}
