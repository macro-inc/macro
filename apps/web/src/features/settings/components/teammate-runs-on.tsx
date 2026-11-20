import { t } from '@app/lib/i18n';

/** The line under an agent's name that says which of the owner's machines runs it. */
export function TeammateRunsOn(props: { host: string }) {
  return (
    <div data-agent-runs-on class="text-xs text-ink-muted truncate">
      {t('teammateHosts.runsOn', { host: props.host })}
    </div>
  );
}
