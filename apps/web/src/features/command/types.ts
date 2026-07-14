import type { HotkeyToken } from '@core/hotkey/tokens';

export type CategoryFilter =
  | 'all'
  | 'commands'
  | 'channels'
  | 'dms'
  | 'tasks'
  | 'documents'
  | 'chats'
  | 'projects'
  | 'people';

/**
 * A single step in a multi-step hotkey display (e.g. "press X then Y").
 * Local to the command palette because it must render both registered tokens
 * and raw key shortcuts (e.g. the go-to leader key).
 */
export type DisplayHotkeyStep = {
  token?: HotkeyToken;
  shortcut?: string;
};
