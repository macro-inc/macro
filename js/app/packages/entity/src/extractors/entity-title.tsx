import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { formatDocumentName } from '@service-storage/util/filename';
import { type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { type EntityData, isGithubPrEntity } from '../types/entity';
import { isSearchEntity } from '../types/search';

function extractRawTitle(entity: EntityData): JSX.Element {
  return match<EntityData, JSX.Element>(entity)
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
    .with({ type: 'call' }, (e) => e.name || blockNameToDefaultFile('call'))
    .with(
      { type: 'automation' },
      (e) => e.name || blockNameToDefaultFile('automation')
    )
    .when(isGithubPrEntity, (e) => (
      <>
        {e.metadata.name}{' '}
        <span class="text-ink-extra-muted font-normal">
          #{e.metadata.number}
        </span>
      </>
    ))
    .with({ type: 'foreign' }, (e) => e.name)
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
        markdown={titleData().text as string}
        theme={unifiedListMarkdownTheme}
        singleLine={true}
      />
    </Show>
  );
}
