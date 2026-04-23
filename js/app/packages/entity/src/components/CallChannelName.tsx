import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { isChannelPreviewItem, useItemPreview } from '@queries/preview';
import { Show } from 'solid-js';
import type { CallEntity } from '../types/entity';
import { isSearchEntity } from '../types/search';

/**
 * Renders the channel name for a call-record list row.
 *
 * `transform-utils` leaves `entity.name` undefined when the channel isn't
 * resolvable from the indexed metadata or the local channels context
 * (happens for search hits on unattended calls). In that case we fall
 * back to the shared `useItemPreview` query to fetch the live name —
 * otherwise we render what we already have without issuing any request.
 *
 * Matches `EntityTitle` for the search-highlight case: if the query
 * matched on the channel name, the highlight is rendered as markdown.
 */
export function CallChannelName(props: { entity: CallEntity }) {
  const highlight = () =>
    isSearchEntity(props.entity)
      ? (props.entity.search.nameHighlight ?? undefined)
      : undefined;

  return (
    <Show when={highlight()} fallback={<CallChannelNameText entity={props.entity} />}>
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

function CallChannelNameText(props: { entity: CallEntity }) {
  return (
    <Show when={!props.entity.name} fallback={<>{props.entity.name}</>}>
      <CallChannelNameFromPreview channelId={props.entity.channelId} />
    </Show>
  );
}

function CallChannelNameFromPreview(props: { channelId: string }) {
  const [preview] = useItemPreview(() => ({
    id: props.channelId,
    type: 'channel' as const,
  }));

  const name = () => {
    const p = preview();
    if (isChannelPreviewItem(p)) return p.name;
    return blockNameToDefaultFile('call');
  };

  return <>{name()}</>;
}
