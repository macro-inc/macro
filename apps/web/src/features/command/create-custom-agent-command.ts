import { t } from '@app/lib/i18n';
import { getIconConfig } from '@core/component/EntityIcon';
import { TOKENS } from '@core/hotkey/tokens';
import type { CreatableBlock } from './types';

/** Bind the new-agent wizard to the host layout. */
export function createCustomAgentCommand(actions: {
  open: () => void;
  close: () => void;
}): CreatableBlock {
  return {
    id: 'Custom agent',
    get label() {
      return t('create.customAgentLabel');
    },
    icon: getIconConfig('agent').icon,
    description: () => t('create.customAgentDescription'),
    get launcherHint() {
      return t('create.customAgentHint');
    },
    keywords: ['new', 'make', 'add', 'agent', 'bot', 'assistant', 'teammate'],
    blockName: 'agent',
    hotkeyToken: TOKENS.create.customAgent,
    hotkey: 'w',
    runWithInputFocused: false,
    keyDownHandler: () => {
      actions.close();
      actions.open();
      return true;
    },
  };
}
