import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import PhoneIcon from '@phosphor/phone.svg';
import type { CreatableBlock } from './types';

/** Bind the call action to the host router without creating a meeting. */
export function createCallCommand(actions: {
  navigate: (path: string) => void;
  close: () => void;
}): CreatableBlock {
  return {
    label: 'Call',
    icon: PhoneIcon,
    description: 'New Call',
    keywords: ['new', 'create', 'meeting', 'video', 'call'],
    blockName: 'call',
    hotkeyToken: TOKENS.create.call,
    hotkey: 'c',
    enabled: () => ENABLE_CALLS,
    runWithInputFocused: false,
    keyDownHandler: () => {
      if (!ENABLE_CALLS) return false;
      actions.close();
      actions.navigate('/meet/new');
      return true;
    },
  };
}
