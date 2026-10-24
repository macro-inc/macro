/**
 * Whether a tool is `Show`, the one an agent shows the user a view with.
 * Replies and chats saved before its rename call it `DisplayResults`.
 */
export function isShowTool(name: string): boolean {
  return name === 'Show' || name === 'DisplayResults';
}
