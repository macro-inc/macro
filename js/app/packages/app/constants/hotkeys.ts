import type { ValidHotkey } from '@core/hotkey/types';
import { registerScope } from '@core/hotkey/utils';

/** Leader key for vim-style "go to" commands (g + key sequences) */
export const GO_TO_LEADER_KEY: ValidHotkey = 'g';

/** Command scope for 'g' leader key (vim-style "go to" commands) */
export const GO_TO_COMMAND_SCOPE = 'command-scope-go-to';

/** Leader key for opening command menu categories */
export const COMMAND_MENU_CATEGORY_LEADER_KEY: ValidHotkey = 'o';

/** Command scope for 'o' leader key (open command menu category) */
export const COMMAND_MENU_CATEGORY_SCOPE =
  'command-scope-command-menu-category';

/** Command scope for create-menu item shortcuts */
export const CREATE_MENU_COMMAND_SCOPE = 'command-scope-create-menu';

// Register the global GO_TO command scope
registerScope({
  parentScopeId: 'global',
  scopeId: GO_TO_COMMAND_SCOPE,
  type: 'command',
  activationKeys: [GO_TO_LEADER_KEY],
});

registerScope({
  parentScopeId: 'global',
  scopeId: COMMAND_MENU_CATEGORY_SCOPE,
  type: 'command',
  activationKeys: [COMMAND_MENU_CATEGORY_LEADER_KEY],
});

registerScope({
  parentScopeId: 'global',
  scopeId: CREATE_MENU_COMMAND_SCOPE,
  type: 'command',
  activationKeys: ['c'],
});
