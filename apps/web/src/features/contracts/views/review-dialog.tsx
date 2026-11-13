import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Dialog } from '@ui';
import { createSignal } from 'solid-js';
import { ReviewCard } from '../components/review-card';
import { useContractsContext } from '../context/contracts-context';
import { blocksSending, placementProblems } from '../core/fields';
import type { Packet } from '../core/packet';
import { placementProblemText } from './place-fields';

/** Step three of a new packet: one last look, then send. */
export function ReviewDialog(props: {
  packet: Packet;
  onEdit: () => void;
  onClose: () => void;
  onSent: (packet: Packet) => void;
}) {
  const context = useContractsContext();
  const [sending, setSending] = createSignal(false);
  const problems = () => placementProblems(props.packet);
  const databases = () =>
    context
      .databases()
      .filter((database) => props.packet.databaseIds.includes(database.id));

  async function send() {
    setSending(true);
    const result = await context.send(props.packet.id);
    setSending(false);
    if (result.isErr()) {
      toast.failure(t('contracts.sendFailed'));
      return;
    }
    toast.success(t('contracts.sent'), { subtext: t('contracts.sentSubtext') });
    props.onSent(result.value);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="w-180 max-w-[calc(100vw-2rem)] p-4"
      visibleScrim
    >
      <Dialog.Title class="sr-only">{t('contracts.reviewTitle')}</Dialog.Title>
      <ReviewCard
        packet={props.packet}
        databases={databases()}
        warnings={problems().map((problem) =>
          placementProblemText(props.packet, problem)
        )}
        blocked={problems().some(blocksSending)}
        sending={sending()}
        onEdit={props.onEdit}
        onSend={() => fireAndForget(send(), 'contracts.send')}
      />
    </Dialog>
  );
}
