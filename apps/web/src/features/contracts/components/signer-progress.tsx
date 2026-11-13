import { t } from '@app/lib/i18n';
import { For } from 'solid-js';
import { match } from 'ts-pattern';
import type { PacketStatus } from '../core/packet';
import type { SignerProgress as Progress } from '../core/status';

function progressLabel(status: PacketStatus, progress: Progress): string {
  const declined = progress.steps.filter((step) => step === 'declined').length;
  return match(status)
    .with('draft', () => t('contracts.signersNotSent'))
    .with('voided', () => t('contracts.statusVoided'))
    .with('declined', () => t('contracts.signersDeclined', { count: declined }))
    .otherwise(() =>
      t('contracts.signersProgress', {
        signed: progress.signed,
        count: progress.total,
      })
    );
}

/** One segment per signer, in signing order, beside a short count. */
export function SignerProgress(props: {
  status: PacketStatus;
  progress: Progress;
}) {
  return (
    <span class="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden="true" class="flex shrink-0 gap-0.5">
        <For each={props.progress.steps}>
          {(step) => (
            <span
              class="h-1 w-3.5 rounded-full"
              classList={{
                'bg-success': step === 'signed',
                'bg-failure': step === 'declined',
                'bg-ink/15': step === 'pending',
              }}
            />
          )}
        </For>
      </span>
      <span class="truncate text-sm text-ink-muted">
        {progressLabel(props.status, props.progress)}
      </span>
    </span>
  );
}
