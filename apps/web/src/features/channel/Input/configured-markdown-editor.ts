import {
  createConfiguredMessageEditor,
  type MessageEditorOptions,
} from '@core/messages/configured-message-editor';

/** Channel surfaces add group mentions and the floating format menu to common editor setup. */
export function createConfiguredChannelMarkdownEditor(
  options: MessageEditorOptions
) {
  return createConfiguredMessageEditor({
    groupMentions: true,
    floatingFormatMenu: true,
    ...options,
  });
}
