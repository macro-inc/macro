import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import { t } from '@app/lib/i18n';
import type { SplitSearchState } from '@app/lib/split-router';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { emailTabSearch, emailTabSearchCodec } from './email-route';

/** Search that opens the mail list on Sent. Absent when Sent is the default tab. */
export function sentMailSearch(): SplitSearchState | undefined {
  const params = emailTabSearchCodec.serialize({ tab: 'sent' });
  if (!params) return;

  return { [emailTabSearch.namespace]: params };
}

/** `g s` opens Sent from any view. Email does not claim this letter. */
export function registerGoToSentHotkey(
  openSent: (event?: KeyboardEvent) => void
) {
  return registerHotkey({
    hotkey: 's',
    scopeId: GO_TO_COMMAND_SCOPE,
    hotkeyToken: TOKENS.sidebar.goTo.sent,
    description: () => t('nav.goTo', { label: t('nav.sent') }),
    keyDownHandler: (event) => {
      openSent(event);
      return true;
    },
    registrationType: 'add',
  });
}
