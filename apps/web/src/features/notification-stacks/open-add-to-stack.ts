import type { OpenDialogOptions } from '@ui';

/**
 * Open the dialog that picks which stacks capture a channel. The stacks
 * feature loads on first use, so menus can offer this without carrying it.
 */
export async function openAddChannelToStack(
  channelId: string,
  options?: OpenDialogOptions
): Promise<void> {
  const { openAddChannelToStackDialog } = await import('./notification-stacks');
  openAddChannelToStackDialog(channelId, options);
}
