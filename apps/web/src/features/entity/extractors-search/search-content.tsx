import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  searchContentHitMarkdownTheme,
  singleLineMarkdownTheme,
  twoLineClampMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { Show } from 'solid-js';
import type { ContentHitData } from '../types/search';

interface SearchContentProps {
  hit?: ContentHitData;
  twoLineClamp?: boolean;
  singleLine?: boolean;
}

/**
 * Displays the content/snippet of a search hit. A snippet is a picture of the
 * message, so its links and mentions are inert: pressing one presses the row
 * and opens the result. Highlights split a URL, so a live link there would
 * open only its first part.
 */
export function SearchContent(props: SearchContentProps) {
  const content = () => props.hit?.content ?? '';
  const theme = () => {
    if (props.twoLineClamp) {
      return twoLineClampMarkdownTheme;
    } else if (props.singleLine) {
      return singleLineMarkdownTheme;
    } else {
      return searchContentHitMarkdownTheme;
    }
  };

  return (
    <Show when={content()}>
      {(text) => (
        <Show
          when={text().trim()}
          fallback={<span class="italic text-ink-disabled">No content</span>}
        >
          {(trimmedContent) => (
            <StaticMarkdown inert markdown={trimmedContent()} theme={theme()} />
          )}
        </Show>
      )}
    </Show>
  );
}
