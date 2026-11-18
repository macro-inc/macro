import {
  StaticLexical,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { textPreviewState } from '../core/text-preview';

/** Shows a file's text as written: each line stays literal, never Markdown. */
export function UnknownTextContent(props: { text: string }) {
  return (
    <div class="size-full select-text overflow-y-auto overscroll-contain touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <div class="wrap-anywhere whitespace-pre-wrap px-6 py-4 font-mono text-sm">
        <StaticMarkdownContext>
          <StaticLexical serializedState={textPreviewState(props.text)} />
        </StaticMarkdownContext>
      </div>
    </div>
  );
}
