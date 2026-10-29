import {
  DefaultShortcuts,
  ListAndQuoteShortcuts,
} from '@core/component/LexicalMarkdown/plugins/keyboard-shortcuts';

/**
 * Formatting keys for the email editors: the inline formats the floating menu
 * advertises (strikethrough, code, highlight) plus the mail-client list and
 * quote keys, Cmd+Shift+7/8/9.
 */
export const EMAIL_FORMAT_SHORTCUTS = [
  ...DefaultShortcuts,
  ...ListAndQuoteShortcuts,
];
