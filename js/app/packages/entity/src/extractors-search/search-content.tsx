import { Show } from 'solid-js';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  searchContentHitMarkdownTheme,
  unifiedListMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import type { ContentHitData } from '../types/search';

interface SearchContentProps {
  hit?: ContentHitData;
  singleLine?: boolean;
}

/**
 * Displays the content/snippet of a search hit
 */
export function SearchContent(props: SearchContentProps) {
  const content = () => props.hit?.content ?? '';

  return (
    <Show when={content()}>
      {(text) => (
        <Show
          when={text().trim()}
          fallback={<span class="italic text-ink-disabled">No content</span>}
        >
          {(trimmedContent) => (
            <StaticMarkdown
              markdown={trimmedContent()}
              theme={
                props.singleLine
                  ? unifiedListMarkdownTheme
                  : searchContentHitMarkdownTheme
              }
              singleLine={props.singleLine}
            />
          )}
        </Show>
      )}
    </Show>
  );
}
