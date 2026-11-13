import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Component } from 'solid-js';
import type {
  SplitFileMenuAction,
  SplitFileMenuActionGroup,
} from './split-layout/context';

/** An action a view offers on its item, as a header button or a title menu row. */
export type BlockTool = {
  label: string | (() => string);
  icon: Component;
  action: () => void;
  children?: SplitFileMenuAction[];
  condition?: () => boolean;
  isActive?: () => boolean;
  buttonComponent?: Component<{ grouped?: boolean }>;
  focusTarget?: () => HTMLElement | null;
  hotkeyToken?: HotkeyToken;
  /** Menu section this tool renders in when shown in the title file menu. */
  group?: SplitFileMenuActionGroup;
};
