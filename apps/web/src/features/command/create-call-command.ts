import { t } from '@app/lib/i18n';
import { TOKENS } from '@core/hotkey/tokens';
import PhoneIcon from '@icon/system/regular/phone.svg';
import type { CreatableBlock } from './types';

/** Bind the call action to the host router without creating a meeting. */
export function createCallCommand(actions: {
  navigate: (path: string) => void;
  close: () => void;
}): CreatableBlock {
  return {
    id: 'Call',
    get label() {
      return t('create.callLabel');
    },
    icon: PhoneIcon,
    description: () => t('create.callDescription'),
    keywords: ['new', 'create', 'meeting', 'video', 'call'],
    blockName: 'call',
    hotkeyToken: TOKENS.create.call,
    hotkey: 'c',
    registrationType: 'add',
    runWithInputFocused: false,
    keyDownHandler: () => {
      actions.close();
      actions.navigate('/meet/new');
      return true;
    },
  };
}
