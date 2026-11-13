import { t } from '@app/lib/i18n';
import { Dialog } from '@ui';
import { CertificatePage } from '../components/certificate-page';
import { buildCertificate } from '../core/certificate';
import type { Packet } from '../core/packet';

/** The packet's audit certificate, as the page appended to the executed PDF. */
export function CertificateDialog(props: {
  packet: Packet;
  onClose: () => void;
}) {
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
      <div class="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <div class="mx-auto w-fit max-w-full overflow-x-auto rounded-xl">
          <CertificatePage certificate={buildCertificate(props.packet)} />
        </div>
      </div>
    </Dialog>
  );
}
