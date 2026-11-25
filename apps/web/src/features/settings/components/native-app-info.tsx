import { formatLocale, t } from '@app/lib/i18n';
import { Button } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { SettingsCard, SettingsRow } from '../primitives';

function DateValue(props: { date?: Date; fallback: string }) {
  return (
    <Show when={props.date} fallback={props.fallback}>
      {(date) => (
        <time datetime={date().toISOString()}>
          {new Intl.DateTimeFormat(formatLocale(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(date())}
        </time>
      )}
    </Show>
  );
}

function Value(props: { children: JSX.Element }) {
  return <span class="text-sm text-ink-muted">{props.children}</span>;
}

/**
 * The installed app: its version and native build, when the binary was built,
 * and, with `showBundle`, which web bundle runs and when it was built.
 */
export function NativeAppAbout(props: {
  /** Undefined while it loads. */
  version?: string;
  /** Undefined when the app can't report it. */
  build?: number;
  buildDate?: Date;
  showBundle: boolean;
  /** Undefined when the app can't report it. */
  bundleSource?: 'embedded' | 'ota';
  bundleDate?: Date;
}) {
  return (
    <SettingsCard>
      <SettingsRow label={t('settingsNativeApp.version')}>
        <Value>{props.version ?? t('settingsNativeApp.loading')}</Value>
      </SettingsRow>
      <SettingsRow label={t('settingsNativeApp.build')}>
        <Value>{props.build ?? t('settingsNativeApp.notAvailable')}</Value>
      </SettingsRow>
      <SettingsRow label={t('settingsNativeApp.buildDate')} stackOnNarrow>
        <Value>
          <DateValue
            date={props.buildDate}
            fallback={t('settingsNativeApp.notAvailable')}
          />
        </Value>
      </SettingsRow>
      <Show when={props.showBundle}>
        <SettingsRow label={t('settingsNativeApp.bundleDate')} stackOnNarrow>
          <Value>
            <Switch fallback={t('settingsNativeApp.notAvailable')}>
              <Match when={props.bundleSource === 'embedded'}>
                {t('settingsNativeApp.builtIn')}
              </Match>
              <Match when={props.bundleSource === 'ota'}>
                <DateValue
                  date={props.bundleDate}
                  fallback={t('settingsNativeApp.notAvailable')}
                />
              </Match>
            </Switch>
          </Value>
        </SettingsRow>
      </Show>
    </SettingsCard>
  );
}

/** An update's status, with the one action that applies to it now. */
export function UpdateStatusRow(props: {
  label: string;
  status: string;
  action?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  return (
    <SettingsRow label={props.label} stackOnNarrow>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Value>{props.status}</Value>
        <Show when={props.action}>
          {(action) => (
            <Button
              variant="primary"
              size="sm"
              disabled={action().disabled}
              onClick={() => action().onClick()}
            >
              {action().label}
            </Button>
          )}
        </Show>
      </div>
    </SettingsRow>
  );
}
