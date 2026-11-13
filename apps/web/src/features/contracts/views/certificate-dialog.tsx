import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckIcon from '@icon/system/regular/check.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import { Dialog } from '@ui';
import { createEffect, createSignal, Match, on, Switch } from 'solid-js';
import { CertificatePage } from '../components/certificate-page';
import { useContractsContext } from '../context/contracts-context';
import { buildCertificate } from '../core/certificate';
import type { Packet } from '../core/packet';

/** The packet's audit certificate, as the page appended to the executed PDF. */
export function CertificateDialog(props: {
  packet: Packet;
  onClose: () => void;
}) {
  const context = useContractsContext();
  // Unknown until the log has been checked against its own hash chain.
  const [intact, setIntact] = createSignal<boolean>();

  async function verify(packet: Packet) {
    const result = await context.verifyLog(packet);
    if (packet === props.packet) setIntact(result);
  }
  createEffect(
    on(
      () => props.packet,
      (packet) => fireAndForget(verify(packet), 'contracts.verify-log')
    )
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="flex max-h-[92dvh] w-[calc(816px+2.5rem)] max-w-[calc(100vw-2rem)] flex-col"
      visibleScrim
    >
      <div class="flex shrink-0 items-center gap-3 px-5 pt-4 pb-3">
        <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-medium">
          {t('contracts.auditCertificate')}
        </Dialog.Title>
        <Dialog.CloseButton />
      </div>
      <div class="flex min-h-6 shrink-0 items-center gap-2 px-5 pb-3 text-sm">
        <Switch>
          <Match when={intact() === true}>
            <CheckIcon class="size-4 shrink-0 text-success" />
            <span role="status" class="text-ink-muted">
              {t('contracts.logVerified')}
            </span>
          </Match>
          <Match when={intact() === false}>
            <WarningIcon class="size-4 shrink-0 text-failure" />
            <span role="alert" class="text-failure-ink">
              {t('contracts.logBroken')}
            </span>
          </Match>
        </Switch>
      </div>
      <div class="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <div class="mx-auto w-fit max-w-full overflow-x-auto rounded-xl">
          <CertificatePage certificate={buildCertificate(props.packet)} />
        </div>
      </div>
    </Dialog>
  );
}
