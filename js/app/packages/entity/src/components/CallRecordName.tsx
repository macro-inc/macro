import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { Show } from 'solid-js';
import type { CallEntity } from '../types/entity';
import { isSearchEntity } from '../types/search';

/** Display name for a call record. Renders the search highlight when present,
 *  otherwise the entity's resolved name. */
export function CallRecordName(props: { entity: CallEntity }) {
  const highlight = () =>
    isSearchEntity(props.entity)
      ? (props.entity.search.nameHighlight ?? undefined)
      : undefined;

  return (
    <Show when={highlight()} fallback={props.entity.name}>
      {(h) => (
        <StaticMarkdown
          markdown={h()}
          theme={unifiedListMarkdownTheme}
          singleLine={true}
        />
      )}
    </Show>
  );
}
