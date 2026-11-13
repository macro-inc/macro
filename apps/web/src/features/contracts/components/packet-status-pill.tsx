import { t } from '@app/lib/i18n';
import { Badge, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { PacketStatus } from '../core/packet';

function packetStatusLabel(status: PacketStatus): string {
  return match(status)
    .with('draft', () => t('contracts.statusDraft'))
    .with('sent', () => t('contracts.statusSent'))
    .with('partially_signed', () => t('contracts.statusPartiallySigned'))
    .with('signed', () => t('contracts.statusSigned'))
    .with('declined', () => t('contracts.statusDeclined'))
    .with('voided', () => t('contracts.statusVoided'))
    .with('expired', () => t('contracts.statusExpired'))
    .exhaustive();
}

/** The system-managed packet status, with its audit tag when overridden. */
export function PacketStatusPill(props: {
  status: PacketStatus;
  /** Signed outside Macro and marked by hand. */
  offline?: boolean;
}) {
  return (
    <span class="inline-flex min-w-0 items-center gap-1.5">
      <Badge variant="outline" size="xs" class="gap-1.5 whitespace-nowrap">
        <span
          aria-hidden="true"
          class="size-2 shrink-0 rounded-full"
          classList={{
            'bg-ink-muted': props.status === 'draft',
            'bg-accent': props.status === 'sent',
            'bg-amber': props.status === 'partially_signed',
            'bg-success': props.status === 'signed',
            'bg-failure': props.status === 'declined',
            'bg-ink-placeholder': props.status === 'voided',
            'bg-orange': props.status === 'expired',
          }}
        />
        {packetStatusLabel(props.status)}
      </Badge>
      <Show when={props.offline}>
        <Tooltip label={t('contracts.offlineHint')}>
          <span class="rounded-sm border border-dashed border-edge px-1.5 py-px font-mono text-xxs font-medium uppercase tracking-wide text-ink-extra-muted">
            {t('contracts.offlineTag')}
          </span>
        </Tooltip>
      </Show>
    </span>
  );
}
