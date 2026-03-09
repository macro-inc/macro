import { Show } from 'solid-js';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  searchContentHitMarkdownTheme,
  searchContentHitTwoLineClampMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import type { ContentHitData } from '../types/search';

interface SearchContentProps {
  hit?: ContentHitData;
  twoLineClamp?: boolean;
}

/**
 * Displays the content/snippet of a search hit
 */
export function SearchContent(props: SearchContentProps) {
  const content = () => props.hit?.content ?? '';
  const theme = () => {
    if (props.twoLineClamp) {
      return searchContentHitTwoLineClampMarkdownTheme;
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
            <StaticMarkdown markdown={trimmedContent()} theme={theme()} />
          )}
        </Show>
      )}
    </Show>
  );
}
