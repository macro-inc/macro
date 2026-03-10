import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import {
  DefaultShortcuts,
  type ItemMention,
  keyboardShortcutsPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { tableCellResizerPlugin } from '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin';
import { tablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/tablePlugin';

type CreateConfiguredChannelMarkdownEditorOptions = {
  namespace: string;
  enableMentions?: boolean;
  onMentionCreate?: (mention: ItemMention) => void;
  onMentionRemove?: (mention: ItemMention) => void;
  onChange?: (markdown: string) => void;
  onEnter?: (event: KeyboardEvent, markdown: string) => boolean;
};

export function createConfiguredChannelMarkdownEditor(
  options: CreateConfiguredChannelMarkdownEditorOptions
) {
  const editor = buildConfig('chat').namespace(options.namespace);

  if (options.enableMentions !== false) {
    editor.withMentions({
      onCreate: options.onMentionCreate,
      onRemove: options.onMentionRemove,
    });
  }

  return editor
    .withEmojis()
    .withLinks({ floatingMenu: true })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withSelectionData()
    .use(
      tablePlugin({
        hasCellMerge: true,
        hasCellBackgroundColor: false,
        hasTabHandler: true,
        hasHorizontalScroll: true,
      })
    )
    .use(tableCellResizerPlugin())
    .use(
      keyboardShortcutsPlugin({
        shortcuts: DefaultShortcuts,
      })
    )
    .onChange(options.onChange)
    .onEnter(options.onEnter);
}
