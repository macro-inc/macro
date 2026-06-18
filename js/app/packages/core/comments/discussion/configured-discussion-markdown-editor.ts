import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import {
  DefaultShortcuts,
  type ItemMention,
  keyboardShortcutsPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { iosCursorScrollPlugin } from '@core/component/LexicalMarkdown/plugins/ios-cursor-scroll';
import { tableCellResizerPlugin } from '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin';
import { tablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/tablePlugin';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import type { IUser } from '@core/user/types';
import type { EditorType } from '@lexical-core';
import { isIOS } from '@solid-primitives/platform';
import type { Accessor } from 'solid-js';

type CreateConfiguredDiscussionMarkdownEditorOptions = {
  namespace: string;
  enableMentions?: boolean;
  onMentionCreate?: (mention: ItemMention) => void;
  onMentionRemove?: (mention: ItemMention) => void;
  users?: () => IUser[];
  onChange?: (markdown: string) => void;
  onEnter?: (event: KeyboardEvent, markdown: string) => boolean;
  scrollContainer?: Accessor<HTMLElement | undefined>;
  type?: EditorType;
};

export function createConfiguredDiscussionMarkdownEditor(
  options: CreateConfiguredDiscussionMarkdownEditorOptions
) {
  const editor = buildConfig(options.type ?? 'chat');
  editor.namespace(options.namespace);

  if (options.enableMentions !== false) {
    // Intentionally no `block: 'channel'` — discussions live inside docs/tasks,
    // not channels, so `@here` doesn't belong here.
    editor.withMentions({
      onCreate: options.onMentionCreate,
      onRemove: options.onMentionRemove,
      users: options.users,
    });
  }

  editor
    .withMedia({ fileDrop: true })
    .withEmojis()
    .withActions({ ignoreActionIds: ['hr', 'table', 'latex'] })
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withSelectionData();

  editor
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

  if ((isIOS || isNativeMobilePlatform()) && options.scrollContainer) {
    editor.use(
      iosCursorScrollPlugin({ scrollContainer: options.scrollContainer })
    );
  }

  return editor;
}
