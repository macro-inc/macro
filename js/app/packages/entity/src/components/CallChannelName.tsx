import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { isChannelPreviewItem, useItemPreview } from '@queries/preview';
import { Show } from 'solid-js';
import type { CallEntity } from '../types/entity';
import { isSearchEntity } from '../types/search';

/** Channel name for a call row — falls back to the preview endpoint when
 *  transform-utils couldn't resolve it locally. */
export function CallChannelName(props: { entity: CallEntity }) {
  const highlight = () =>
    isSearchEntity(props.entity)
      ? (props.entity.search.nameHighlight ?? undefined)
      : undefined;

  return (
    <Show
      when={highlight()}
      fallback={<CallChannelNameText entity={props.entity} />}
    >
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
    <Show
      when={props.entity.name}
      fallback={
        <CallChannelNameFromPreview channelId={props.entity.channelId} />
      }
    >
      {props.entity.name}
    </Show>
  );
}

// TODO: once we have call record rename/preview, we should use that instead of the channel name
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
