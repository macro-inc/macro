import type { BlockAlias, BlockName } from '@core/block';
import type { HotkeyToken } from '@core/hotkey/tokens';
import type { HotkeyRegistrationOptions } from '@core/hotkey/types';
import type { Component } from 'solid-js';

/**
 * What a create-menu entry makes.
 *
 * Every block, plus the things the menu can create that have no block of their
 * own. A reminder is one: it is not a document type, it opens no split, and
 * `EntityIcon` already knows the name — which is why it is a member here rather
 * than in `BlockAliasRegistry`, where it would leak into `fileTypeToBlockName`,
 * split content types and `NonDocumentBlockTypes`.
 */
export type CreatableName = BlockName | BlockAlias | 'reminder';

export type CreatableBlock = Omit<HotkeyRegistrationOptions, 'scopeId'> & {
  label: string;
  launcherHint?: string;
  blockName: CreatableName;
  altHotkeyToken?: HotkeyToken;
  animatedIcon?: Component<{ triggerAnimation?: boolean }>;
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
