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
    .with({ type: 'channel_thread' }, (e) => e.name)
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
    .with({ type: 'crm_company' }, (e) => e.name || 'Unknown Company')
    .with(
      { type: 'crm_contact' },
      (e) => e.name || e.email || 'Unknown Contact'
    )
    .otherwise(() => 'Unknown');
}

function extractSearchHighlight(entity: EntityData): string | undefined {
  if (!isSearchEntity(entity)) return undefined;
  const highlight = entity.search.nameHighlight ?? undefined;
  if (!highlight) return undefined;
  return withExtensionSuffix(highlight, entity);
}

// Server name highlights are built from the unformatted document name, so
// they lack the extension suffix formatDocumentName adds; local fuzzy
// highlights are built from the formatted name and already carry it.
function withExtensionSuffix(highlight: string, entity: EntityData): string {
  if (entity.type !== 'document' || !entity.fileType) return highlight;
  const suffix = `.${entity.fileType}`;
  const formatted = formatDocumentName(entity.name, entity.fileType, {
    fullyQualifiedBlockName: true,
  });
  if (!formatted.endsWith(suffix)) return highlight;
  const plain = highlight.replace(/<\/?macro_em>/g, '');
  if (plain.endsWith(suffix)) return highlight;
  return `${highlight}${suffix}`;
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
