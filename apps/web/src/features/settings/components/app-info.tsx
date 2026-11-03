import { Show } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsRow } from '../primitives';

function DateValue(props: { date?: Date; fallback: string }) {
  return (
    <span class="text-sm text-ink-muted">
      <Show when={props.date} fallback={props.fallback}>
        {(date) => (
          <time datetime={date().toISOString()}>
            {date().toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
        )}
      </Show>
    </span>
  );
}

/** Installed native app details: version, build, and the active OTA bundle. */
export function AppInfo(props: {
  title: string;
  description: string;
  version: string;
  buildDate?: Date;
  bundleDate?: Date;
}) {
  return (
    <SettingsPage title={props.title} description={props.description}>
      <SettingsCard>
        <SettingsRow label="Version">
          <span class="text-sm text-ink-muted">{props.version}</span>
        </SettingsRow>
        <SettingsRow label="Build date" stackOnNarrow>
          <DateValue date={props.buildDate} fallback="Not available" />
        </SettingsRow>
        <SettingsRow label="Bundle date" stackOnNarrow>
          <DateValue date={props.bundleDate} fallback="No OTA update" />
        </SettingsRow>
      </SettingsCard>
    </SettingsPage>
  );
}
