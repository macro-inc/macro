import { t } from '@app/lib/i18n';

/**
 * After an agent's status: which of the owner's machines runs it, or, while
 * it moves, the one it is moving to.
 */
export function TeammateRunsOn(props: { host: string; moving?: boolean }) {
  return (
    <span data-agent-runs-on class="min-w-0 truncate text-xs text-ink-muted">
      {props.moving
        ? t('teammateHosts.movingTo', { host: props.host })
        : t('teammateHosts.runsOn', { host: props.host })}
    </span>
  );
}
