import type { BlockAlias, BlockName } from '@core/block';
import type { HotkeyToken } from '@core/hotkey/tokens';
import type { HotkeyRegistrationOptions } from '@core/hotkey/types';
import type { Component } from 'solid-js';

export type CreatableBlock = Omit<HotkeyRegistrationOptions, 'scopeId'> & {
  label: string;
  blockName: BlockName | BlockAlias;
  altHotkeyToken?: HotkeyToken;
  animatedIcon?: Component<{ triggerAnimation?: boolean }>;
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
