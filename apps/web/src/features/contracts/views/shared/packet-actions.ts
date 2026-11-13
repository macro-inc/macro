import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { confirmDialog } from '@ui';
import type { ContractsContext } from '../../context/contracts-context';
import type { Packet, Recipient } from '../../core/packet';

/**
 * The things a sender can do to a packet, by name. Each view lists the ones
 * it offers; every action reports its own outcome.
 */
export function createPacketActions(context: ContractsContext) {
  return {
    async copySigningLink(recipient: Recipient) {
      if (!recipient.access) return;
      const copied = await context.copyText(
        context.signingUrl(recipient.access.token)
      );
      if (copied) {
        toast.success(t('contracts.linkCopied', { name: recipient.name }));
      } else {
        toast.failure(t('contracts.linkCopyFailed'));
      }
    },

    openSigning(recipient: Recipient) {
      if (recipient.access) context.openSigning(recipient.access.token);
    },

    async remind(packet: Packet) {
      const result = await context.remind(packet.id);
      if (result.isErr()) {
        toast.failure(t('contracts.actionFailed'));
        return;
      }
      toast.success(t('contracts.reminderRecorded'), {
        subtext: t('contracts.reminderRecordedSubtext'),
      });
    },

    async voidPacket(packet: Packet) {
      const confirmed = await confirmDialog({
        title: t('contracts.voidTitle', { title: packet.title }),
        body: t('contracts.voidBody'),
        confirmLabel: t('contracts.void'),
        tone: 'danger',
      });
      if (!confirmed) return;

      const result = await context.voidPacket(packet.id, '');
      if (result.isErr()) toast.failure(t('contracts.actionFailed'));
    },

    async markSignedOffline(packet: Packet) {
      const confirmed = await confirmDialog({
        title: t('contracts.offlineTitle', { title: packet.title }),
        body: t('contracts.offlineBody'),
        confirmLabel: t('contracts.markSignedOffline'),
      });
      if (!confirmed) return;

      const result = await context.markSignedOffline(packet.id);
      if (result.isErr()) toast.failure(t('contracts.actionFailed'));
    },

    async deleteDraft(packet: Packet) {
      const confirmed = await confirmDialog({
        title: t('contracts.deleteDraftTitle', { title: packet.title }),
        body: t('contracts.deleteDraftBody'),
        confirmLabel: t('contracts.deleteDraft'),
        tone: 'danger',
      });
      if (!confirmed) return false;

      const result = await context.deleteDraft(packet.id);
      if (result.isErr()) {
        toast.failure(t('contracts.actionFailed'));
        return false;
      }
      return true;
    },

    /** Swap one document for a revised PDF and tell signers to start over. */
    async replaceDocument(packet: Packet, documentId: string, file: File) {
      const imported = await context.importDocument(file);
      if (imported.isErr()) {
        toast.failure(
          imported.error.kind === 'not_pdf'
            ? t('contracts.onlyPdf')
            : t('contracts.documentUnreadable')
        );
        return;
      }

      const result = await context.replaceDocument(
        packet.id,
        documentId,
        imported.value
      );
      if (result.isErr()) {
        // The revision was stored for a change that did not happen.
        await context.discardDocument(imported.value.id);
        toast.failure(
          result.error.kind === 'signature_field_lost'
            ? t('contracts.replaceLosesSignature')
            : t('contracts.actionFailed')
        );
        return;
      }
      toast.success(t('contracts.documentReplaced'));
    },
  };
}
