import { t } from '@app/lib/i18n';
import { Spinner } from '@ui/components/Spinner';
import { cn } from '@ui/utils/classname';
import { match } from 'ts-pattern';
import type { ScreenStatus } from '../core/screen-status';

/** Who drives, as the pill shows it; `undefined` when nobody does. */
export type DriverLabel =
  | { kind: 'me' }
  /** We hold the lease from another tab: input here is not accepted. */
  | { kind: 'meElsewhere' }
  | { kind: 'other'; name: string };

/** The small state pill: live, reconnecting, asleep, ended, or who is driving. */
export function StatusPill(props: {
  status: ScreenStatus;
  driver: DriverLabel | undefined;
  class?: string;
}) {
  const content = () => {
    const driver = props.driver;
    if (driver && props.status.kind === 'live') {
      return {
        tone: 'drive' as const,
        label: match(driver)
          .with({ kind: 'me' }, () => t('agentScreen.youAreDriving'))
          .with({ kind: 'meElsewhere' }, () =>
            t('agentScreen.youAreDrivingElsewhere')
          )
          .with({ kind: 'other' }, ({ name }) =>
            t('agentScreen.someoneIsDriving', { name })
          )
          .exhaustive(),
        busy: false,
      };
    }
    return match(props.status)
      .with({ kind: 'connecting' }, () => ({
        tone: 'muted' as const,
        label: t('agentScreen.statusConnecting'),
        busy: true,
      }))
      .with({ kind: 'live' }, () => ({
        tone: 'live' as const,
        label: t('agentScreen.statusLive'),
        busy: false,
      }))
      .with({ kind: 'reconnecting' }, () => ({
        tone: 'warn' as const,
        label: t('agentScreen.statusReconnecting'),
        busy: true,
      }))
      .with({ kind: 'waking' }, () => ({
        tone: 'muted' as const,
        label: t('agentScreen.statusWaking'),
        busy: true,
      }))
      .with({ kind: 'asleep' }, () => ({
        tone: 'muted' as const,
        label: t('agentScreen.statusAsleep'),
        busy: false,
      }))
      .with({ kind: 'denied' }, { kind: 'ended' }, () => ({
        tone: 'muted' as const,
        label: t('agentScreen.statusEnded'),
        busy: false,
      }))
      .exhaustive();
  };

  return (
    <span
      // Who drives, and the connection's state, are announced as they change.
      role="status"
      aria-live="polite"
      class={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        content().tone === 'live' && 'bg-green-bg text-green-ink',
        content().tone === 'drive' && 'bg-amber-bg text-amber-ink',
        content().tone === 'warn' && 'bg-alert-bg text-alert-ink',
        content().tone === 'muted' && 'bg-panel text-ink-muted',
        props.class
      )}
    >
      {content().busy ? (
        <Spinner class="size-3" decorative />
      ) : (
        <span class="size-1.5 rounded-full bg-current" />
      )}
      {content().label}
    </span>
  );
}
