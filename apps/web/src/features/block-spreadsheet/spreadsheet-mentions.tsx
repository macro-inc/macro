import {
  type MacroMentionLinkResolver,
  useMacroMentionLinkResolver,
} from '@components/app/split-layout/split-router/mention-links';
import { DocumentMention } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';
import { UserMention } from '@core/component/LexicalMarkdown/component/decorator/UserMention';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu';
import { getBlockNameFromEntity } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils';
import { parseMacroAppUrl } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import type { MentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import {
  cellTextParts,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import { For, Suspense } from 'solid-js';
import { CellMentionEditor } from './components/CellMentionEditor';
import type {
  CellTextEditorProps,
  SpreadsheetMentions,
} from './context/spreadsheet-mentions';
import { SpreadsheetCellLinks } from './spreadsheet-cell-links';

export function linkMentions(
  value: string,
  resolveAppLink?: MacroMentionLinkResolver
): string {
  if (value.startsWith('=')) return value;
  return cellTextParts(value)
    .map((part) =>
      part.mention
        ? part.text
        : part.text.replace(/https?:\/\/[^\s<>]+/g, (url) => {
            const legacy = parseMacroAppUrl(url);
            const parsed = legacy.isValid ? legacy : resolveAppLink?.(url);
            return parsed?.id && parsed.block
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
}
function CellMentions(props: { value: string }) {
  const resolveAppLink = useMacroMentionLinkResolver();
  return (
    <For each={cellTextParts(linkMentions(props.value, resolveAppLink))}>
      {(part) => {
        const mention = part.mention;
        if (!mention) return <SpreadsheetCellLinks value={part.text} />;
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
function SpreadsheetMentionEditor(props: CellTextEditorProps) {
  const resolveAppLink = useMacroMentionLinkResolver();
  return (
    <CellMentionEditor
      {...props}
      convertPaste={(text) => linkMentions(text, resolveAppLink)}
      renderMenu={(menu, anchor, pick) => (
        <MentionsMenu
          menu={menu}
          anchor={anchor}
          sources={['users', 'documents', 'channels', 'emails']}
          showOpenTabs={false}
          onPick={(item) => {
            const value = fromItem(item);
            if (value) pick(value);
          }}
        />
      )}
    />
  );
}

export const spreadsheetMentions: SpreadsheetMentions = {
  renderText: (value) => <CellMentions value={value} />,
  renderEditor: (props) => <SpreadsheetMentionEditor {...props} />,
};
