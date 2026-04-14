import { formatDocumentName } from '@service-storage/util/filename';
import { match } from 'ts-pattern';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { Show } from 'solid-js';
import type { EntityData } from '../types/entity';
import { isSearchEntity } from '../types/search';

function extractRawTitle(entity: EntityData): string {
  return match(entity)
    .with({ type: 'document' }, (e) =>
      formatDocumentName(e.name, e.fileType, {
        fullyQualifiedBlockName: true,
      })
    )
    .with({ type: 'project' }, (e) => e.name)
    .with({ type: 'channel' }, (e) => e.name)
    .with({ type: 'channel_message' }, (e) => e.channelName)
    .with({ type: 'email' }, (e) => e.name || '(No Subject)')
    .with({ type: 'chat' }, (e) => e.name)
    .otherwise(() => 'Unknown');
}

function extractSearchHighlight(entity: EntityData): string | undefined {
  if (!isSearchEntity(entity)) return undefined;
  return entity.search.nameHighlight ?? undefined;
}

export function EntityTitle(props: { entity: EntityData }) {
  const titleData = () => {
    const searchHighlight = extractSearchHighlight(props.entity);
    if (searchHighlight) {
      return {
        text: searchHighlight,
        isMarkdown: true,
      };
    }

    return {
      text: extractRawTitle(props.entity),
      isMarkdown: false,
    };
  };

  return (
    <Show
      when={titleData().isMarkdown}
      fallback={<span class="truncate">{titleData().text}</span>}
    >
      <StaticMarkdown
        markdown={titleData().text}
        theme={unifiedListMarkdownTheme}
        singleLine={true}
      />
    </Show>
  );
}
