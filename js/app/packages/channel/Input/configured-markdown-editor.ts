import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import {
  DefaultShortcuts,
  type ItemMention,
  keyboardShortcutsPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import {
  type Action,
  ActionCategory,
} from '@core/component/LexicalMarkdown/plugins/actions/types';
import { iosCursorScrollPlugin } from '@core/component/LexicalMarkdown/plugins/ios-cursor-scroll';
import { tableCellResizerPlugin } from '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin';
import { tablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/tablePlugin';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import type { IUser } from '@core/user/types';
import ImageIcon from '@phosphor/image.svg';
import { isIOS } from '@solid-primitives/platform';
import type { Accessor } from 'solid-js';

type CreateConfiguredChannelMarkdownEditorOptions = {
  namespace: string;
  enableMentions?: boolean;
  onMentionCreate?: (mention: ItemMention) => void;
  onMentionRemove?: (mention: ItemMention) => void;
  users?: () => IUser[];
  onChange?: (markdown: string) => void;
  onEnter?: (event: KeyboardEvent, markdown: string) => boolean;
  onPasteFilesAndDirs?: (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => void;
  /** Invoked when the user picks the "Image" slash action. Opens a file picker and hands files back. */
  onAttachFromDisk?: (files: File[]) => void;
  scrollContainer?: Accessor<HTMLElement | undefined>;
};

export function createConfiguredChannelMarkdownEditor(
  options: CreateConfiguredChannelMarkdownEditorOptions
) {
  const editor = buildConfig('chat').namespace(options.namespace);

  if (options.enableMentions !== false) {
    editor.withMentions({
      onCreate: options.onMentionCreate,
      onRemove: options.onMentionRemove,
      users: options.users,
      block: 'channel',
    });
  }

  if (options.onPasteFilesAndDirs) {
    editor.withFilePaste({
      onPasteFilesAndDirs: options.onPasteFilesAndDirs,
    });
  }

  editor
    .withEmojis()
    .withActions({ ignoreActionIds: ['hr', 'table', 'latex'] })
    .withLinks({ floatingMenu: true })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withSelectionData();

  if (options.onAttachFromDisk) {
    const onAttachFromDisk = options.onAttachFromDisk;
    const attachFromDiskAction: Action = {
      id: 'image',
      name: 'Image',
      keywords: ['picture', 'photo', 'img', 'upload', 'attach'],
      category: ActionCategory.MEDIA,
      icon: ImageIcon,
      action: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.addEventListener('change', () => {
          const files = Array.from(input.files ?? []);
          if (files.length > 0) onAttachFromDisk(files);
        });
        input.click();
      },
    };
    editor.withActions({ additionalActions: [attachFromDiskAction] });
  }

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
