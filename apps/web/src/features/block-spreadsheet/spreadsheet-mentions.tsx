import { DocumentMention } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';
import { UserMention } from '@core/component/LexicalMarkdown/component/decorator/UserMention';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu';
import { getBlockNameFromEntity } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils';
import { parseMacroAppUrl } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import type { MentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { formatRelativeDay, formatTooltipDate } from '@core/util/dateParser';
import {
  type CellDateMention,
  cellTextParts,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import ClockIcon from '@phosphor/clock.svg';
import { For, Suspense } from 'solid-js';
import { CellMentionEditor } from './components/CellMentionEditor';
import type { SpreadsheetMentions } from './context/spreadsheet-mentions';
import { SpreadsheetCellLinks } from './spreadsheet-cell-links';

function linkMentions(value: string): string {
  if (value.startsWith('=')) return value;
  return cellTextParts(value)
    .map((part) =>
      part.mention
        ? part.text
        : part.text.replace(/https?:\/\/[^\s<>]+/g, (url) => {
            const parsed = parseMacroAppUrl(url);
            return parsed.isValid && parsed.id && parsed.block
              ? encodeCellMention({
                  type: 'document',
                  documentId: parsed.id,
                  documentName: '',
                  blockName: parsed.block,
                  blockParams: parsed.params,
                })
              : url;
          })
    )
    .join('');
}
function fromItem(item: MentionItem): string | undefined {
  if (item.kind === 'user')
    return encodeCellMention({
      type: 'user',
      userId: item.id,
      email: item.data.email,
      displayName: item.data.name,
    });
  if (item.kind === 'entity')
    return encodeCellMention({
      type: 'document',
      documentId: item.id,
      documentName: item.data.name ?? '',
      blockName: getBlockNameFromEntity(item),
    });
  if (item.kind === 'date')
    return encodeCellMention({
      type: 'date',
      date: item.data.date.toISOString(),
      displayFormat: item.data.displayText,
    });
}
/** Same chip as docs, without the picker: edit the cell to change the date. */
function CellDateChip(props: CellDateMention) {
  const date = () => new Date(props.date);
  return (
    <span
      data-spreadsheet-mention
      data-date={props.date}
      class="inline-block max-w-full align-bottom truncate rounded-md bg-accent/8 p-0.5 text-accent"
      title={formatTooltipDate(date())}
    >
      <span class="relative top-[0.125em] mx-0.5 inline-flex size-[1em]">
        <ClockIcon class="size-full" />
      </span>
      {formatRelativeDay(date())}
    </span>
  );
}
function CellMentions(props: { value: string }) {
  return (
    <For each={cellTextParts(linkMentions(props.value))}>
      {(part) => {
        const mention = part.mention;
        if (!mention) return <SpreadsheetCellLinks value={part.text} />;
        if (mention.type === 'date') return <CellDateChip {...mention} />;
        return (
          <span
            data-spreadsheet-mention
            class="inline-block max-w-full align-bottom truncate"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDblClick={(event) => event.stopPropagation()}
          >
            <Suspense
              fallback={
                mention.type === 'user'
                  ? mention.email
                  : mention.documentName || 'Linked item'
              }
            >
              {mention.type === 'user' ? (
                <UserMention {...mention} key="spreadsheet" theme={{}} />
              ) : (
                <DocumentMention {...mention} key="spreadsheet" theme={{}} />
              )}
            </Suspense>
          </span>
        );
      }}
    </For>
  );
}
export const spreadsheetMentions: SpreadsheetMentions = {
  renderText: (value) => <CellMentions value={value} />,
  renderEditor: (props) => (
    <CellMentionEditor
      {...props}
      convertPaste={linkMentions}
      renderMenu={(menu, anchor, pick) => (
        <MentionsMenu
          menu={menu}
          anchor={anchor}
          sources={['users', 'documents', 'channels', 'emails', 'dates']}
          showOpenTabs={false}
          onPick={(item) => {
            const value = fromItem(item);
            if (value) pick(value);
          }}
        />
      )}
    />
  ),
};
