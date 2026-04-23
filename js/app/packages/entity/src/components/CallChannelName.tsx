import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { isChannelPreviewItem, useItemPreview } from '@queries/preview';
import { Show } from 'solid-js';
import type { CallEntity } from '../types/entity';
import { isSearchEntity } from '../types/search';

/**
 * Calls can surface channels the user isn't a member of (search hits on
 * unattended calls). Those channels aren't in the local channels context,
 * so the entity's baked-in `channelName` falls back to the generic "Call"
 * default. Pull the live name from the preview endpoint instead — renders
 * immediately with the baked-in value and swaps in the fetched name when
 * it resolves, never blocking the list row.
 *
 * Matches `EntityTitle` for the highlighted-hit case: when the search
 * matched on the channel name, we render the highlight as markdown
 * instead of the plain name.
 */
export function CallChannelName(props: { entity: CallEntity }) {
  const [preview] = useItemPreview(() => ({
    id: props.entity.channelId,
    type: 'channel' as const,
  }));

  const highlight = () =>
    isSearchEntity(props.entity)
      ? (props.entity.search.nameHighlight ?? undefined)
      : undefined;

  const name = () => {
    const p = preview();
    if (isChannelPreviewItem(p)) return p.name;
    return props.entity.channelName ?? props.entity.name;
  };

  return (
    <Show when={highlight()} fallback={<>{name()}</>}>
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
