import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import {
  DefaultShortcuts,
  keyboardShortcutsPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { tableCellResizerPlugin } from '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin';
import { tablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/tablePlugin';

/**
 * Shared chat editor builder with all standard plugins.
 * Consumers chain `.withMentions({ onCreate })` for mention handling.
 */
export function buildChatEditor() {
  return buildConfig('chat')
    .namespace('chat-markdown-area')
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
    .use(keyboardShortcutsPlugin({ shortcuts: DefaultShortcuts }));
}
