import type { OpenDialogOptions } from '@ui';

/**
 * Open the dialog that picks which stacks capture a channel. Leave `name` out
 * for a direct message: a stack never matches one by name. The stacks feature
 * loads on first use, so menus can offer this without carrying it.
 */
export async function openAddChannelToStack(
  channel: { id: string; name?: string },
  options?: OpenDialogOptions
): Promise<void> {
  const { openAddChannelToStackDialog } = await import('./notification-stacks');
  openAddChannelToStackDialog(channel, options);
}
