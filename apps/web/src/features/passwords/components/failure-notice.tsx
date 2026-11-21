import { t } from '@app/lib/i18n';
import { Match, Switch } from 'solid-js';
import type { PasswordFailure } from '../context/passwords-context';

/** Why the last action on an item or draft failed, as an alert. */
export function FailureNotice(props: {
  failure: PasswordFailure | 'totp' | undefined;
  class?: string;
}) {
  const alert = (text: string) => (
    <p role="alert" class={`text-sm text-failure-ink ${props.class ?? ''}`}>
      {text}
    </p>
  );
  return (
    <Switch>
      <Match when={props.failure === 'totp'}>
        {alert(t('passwords.totpFailed'))}
      </Match>
      <Match when={props.failure === 'folderMissing'}>
        {alert(t('passwords.folderMissing'))}
      </Match>
      <Match when={props.failure === 'unreachable'}>
        {alert(t('passwords.unreachable'))}
      </Match>
      <Match when={props.failure === 'serviceUnavailable'}>
        {alert(t('passwords.serviceUnavailable'))}
      </Match>
      <Match when={props.failure === 'notProvisioned'}>
        {alert(t('passwords.vaultNotProvisioned'))}
      </Match>
      <Match when={props.failure}>{alert(t('passwords.failed'))}</Match>
    </Switch>
  );
}
