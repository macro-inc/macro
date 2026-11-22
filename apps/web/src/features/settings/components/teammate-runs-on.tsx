import { t } from '@app/lib/i18n';

/** After an agent's status: which of the owner's machines runs it. */
export function TeammateRunsOn(props: { host: string }) {
  return (
    <span data-agent-runs-on class="min-w-0 truncate text-xs text-ink-muted">
      {t('teammateHosts.runsOn', { host: props.host })}
    </span>
  );
}
