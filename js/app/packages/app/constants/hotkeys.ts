import type { ValidHotkey } from '@core/hotkey/types';
import { registerScope } from '@core/hotkey/utils';

/** Leader key for vim-style "go to" commands (g + key sequences) */
export const GO_TO_LEADER_KEY: ValidHotkey = 'g';

/** Command scope for 'g' leader key (vim-style "go to" commands) */
export const GO_TO_COMMAND_SCOPE = 'command-scope-go-to';

// Register the global GO_TO command scope
registerScope({
  parentScopeId: 'global',
  scopeId: GO_TO_COMMAND_SCOPE,
  type: 'command',
  activationKeys: [GO_TO_LEADER_KEY],
});
