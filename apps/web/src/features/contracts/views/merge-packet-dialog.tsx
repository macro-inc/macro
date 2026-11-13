import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ActionDialogShell, Button, Dialog, RadioGroup } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { PacketStatusPill } from '../components/packet-status-pill';
import { useContractsContext } from '../context/contracts-context';
import { canMerge } from '../core/lifecycle';
import type { Packet } from '../core/packet';
import { packetStatus } from '../core/status';

/**
 * Fold another packet into this one, for a packet created by mistake instead
 * of updating an existing one. The chosen packet's documents, recipients,
 * fields, and databases move here and its history is kept; it is then gone.
 */
export function MergePacketDialog(props: {
  /** The packet that stays. */
  packet: Packet;
  onClose: () => void;
  onMerged: (packet: Packet) => void;
}) {
  const context = useContractsContext();
  const [sourceId, setSourceId] = createSignal('');
  const [merging, setMerging] = createSignal(false);

  const candidates = () =>
    context
      .packets()
      .filter(
        (each) => each.id !== props.packet.id && canMerge(each, context.now())
      );
  const statusOf = (packet: Packet) => packetStatus(packet, context.now());
  /** A packet already out for signature starts signing over once it grows. */
  const restartsSigning = () => statusOf(props.packet) !== 'draft';

  async function merge(event: SubmitEvent) {
    event.preventDefault();
    if (!sourceId()) return;

    setMerging(true);
    const result = await context.mergePackets(props.packet.id, sourceId());
    setMerging(false);
    if (result.isErr()) {
      toast.failure(
        result.error.kind === 'cannot_send'
          ? t('contracts.mergeNeedsSignature')
          : t('contracts.actionFailed')
      );
      return;
    }
    toast.success(t('contracts.merged'));
    props.onMerged(result.value);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="w-130 max-w-[calc(100vw-2rem)]"
      visibleScrim
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          onSubmit={(event) => fireAndForget(merge(event), 'contracts.merge')}
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                {t('contracts.mergeTitle', { title: props.packet.title })}
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {t('contracts.mergeDescription')}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>

            <Show
              when={candidates().length > 0}
              fallback={
                <p class="rounded-xl border border-dashed border-edge px-4 py-5 text-center text-sm text-ink-extra-muted">
                  {t('contracts.mergeNothing')}
                </p>
              }
            >
              <RadioGroup
                value={sourceId()}
                onChange={setSourceId}
                aria-label={t('contracts.mergeChoose')}
                class="flex max-h-72 flex-col gap-1 overflow-auto"
              >
                <For each={candidates()}>
                  {(candidate) => (
                    <RadioGroup.Item
                      value={candidate.id}
                      class="flex min-h-11 items-center gap-3 rounded-xl border border-edge-muted px-3 data-[checked]:border-ink"
                    >
                      <RadioGroup.ItemControl />
                      <RadioGroup.ItemLabel class="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-sm font-medium">
                          {candidate.title}
                        </span>
                        <span class="shrink-0 text-xs text-ink-extra-muted">
                          {t('contracts.documentCount', {
                            count: candidate.documents.length,
                          })}
                        </span>
                        <PacketStatusPill status={statusOf(candidate)} />
                      </RadioGroup.ItemLabel>
                    </RadioGroup.Item>
                  )}
                </For>
              </RadioGroup>
            </Show>

            <Show when={restartsSigning()}>
              <p class="text-sm text-ink-muted">
                {t('contracts.mergeRestartsSigning')}
              </p>
            </Show>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button variant="ghost" onClick={() => props.onClose()}>
              {t('contracts.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!sourceId()}
              loading={merging()}
            >
              {t('contracts.mergeConfirm')}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
