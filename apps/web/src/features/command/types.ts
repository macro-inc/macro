import type { BlockAlias, BlockName } from '@core/block';
import type { HotkeyToken } from '@core/hotkey/tokens';
import type { HotkeyRegistrationOptions } from '@core/hotkey/types';

export type CreatableName = BlockName | BlockAlias | 'initiative';

export type CreatableBlock = Omit<HotkeyRegistrationOptions, 'scopeId'> & {
  label: string;
  launcherHint?: string;
  blockName: CreatableName;
  altHotkeyToken?: HotkeyToken;
  /**
   * Whether the entry is available at all, for one behind a feature flag.
   *
   * Read by every surface that renders or binds these — `useCreateMenuBlocks`
   * for the menus, `GlobalHotkeys` for the keys — so a gated entry cannot be
   * shown in one and hidden in the other. Absent means always available.
   */
  enabled?: () => boolean;
};

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
