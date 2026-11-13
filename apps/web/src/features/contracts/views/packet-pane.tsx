import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import BellIcon from '@icon/system/regular/bell.svg';
import ShieldCheckIcon from '@icon/system/regular/shield-check.svg';
import SignatureIcon from '@icon/system/regular/signature.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dropdown } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { PacketStatusPill } from '../components/packet-status-pill';
import { useContractsContext } from '../context/contracts-context';
import type { Packet } from '../core/packet';
import type { PacketRow } from '../core/packet-row';
import { isInFlight } from '../core/status';
import { createPacketActions } from './shared/packet-actions';
import { PacketSummary } from './shared/packet-summary';

/** The packet drawer: status, quick actions, and the packet's summary. */
export function PacketPane(props: {
  row: PacketRow;
  onClose: () => void;
  onPlaceFields: (packetId: string) => void;
  onCertificate: (packetId: string) => void;
  onOpenDocument: (packet: Packet, documentId: string) => void;
}) {
  const context = useContractsContext();
  const actions = createPacketActions(context);
  const packet = () => props.row.packet;
  let fileInput!: HTMLInputElement;
  let replacing: string | undefined;

  function chooseReplacement(documentId: string) {
    replacing = documentId;
    fileInput.click();
  }

  function replaceWith(file: File | undefined) {
    const documentId = replacing;
    replacing = undefined;
    fileInput.value = '';
    if (!file || !documentId) return;
    fireAndForget(
      actions.replaceDocument(packet(), documentId, file),
      'contracts.replace-document'
    );
  }

  async function remove() {
    if (await actions.deleteDraft(packet())) props.onClose();
  }

  return (
    <section
      aria-label={t('contracts.packetPane', { title: packet().title })}
      class="flex h-full min-h-0 flex-col bg-panel"
    >
      <header class="flex min-h-12 shrink-0 items-center gap-2 px-3">
        <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-ink/5">
          <SignatureIcon class="size-3.5 text-ink-muted" />
        </span>
        <h2 class="min-w-0 truncate text-sm font-semibold tracking-tight">
          {packet().title}
        </h2>
        <PacketStatusPill
          status={props.row.status}
          offline={packet().statusOverride?.tag === 'offline'}
        />
        <div class="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('contracts.closePacket')}
          tooltip={t('contracts.closePacket')}
          onClick={() => props.onClose()}
        >
          <XIcon class="size-3.5" />
        </Button>
      </header>

      <div class="flex shrink-0 flex-wrap gap-1.5 border-b border-edge-muted px-4 pt-1 pb-3.5">
        <Switch>
          <Match when={props.row.status === 'draft'}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => props.onPlaceFields(packet().id)}
            >
              {t('contracts.continuePlacing')}
            </Button>
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => fireAndForget(remove(), 'contracts.delete-draft')}
            >
              {t('contracts.deleteDraft')}
            </Button>
          </Match>
          <Match when={true}>
            <Show when={isInFlight(props.row.status)}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  fireAndForget(actions.remind(packet()), 'contracts.remind')
                }
              >
                <BellIcon class="size-3.5" />
                {t('contracts.resendReminder')}
              </Button>
              <Dropdown>
                <Dropdown.Trigger as={Button} variant="secondary" size="sm">
                  <UploadIcon class="size-3.5" />
                  {t('contracts.reupload')}
                </Dropdown.Trigger>
                <Dropdown.Content class="max-w-80 min-w-56">
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>
                      {t('contracts.reuploadWhich')}
                    </Dropdown.GroupLabel>
                    <For each={packet().documents}>
                      {(document) => (
                        <Dropdown.Item
                          closeOnSelect
                          onSelect={() => chooseReplacement(document.id)}
                        >
                          <span class="truncate">
                            {t('contracts.replaceNamed', {
                              name: document.name,
                            })}
                          </span>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </Show>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.onCertificate(packet().id)}
            >
              <ShieldCheckIcon class="size-3.5" />
              {t('contracts.auditCertificate')}
            </Button>
            <Show
              when={
                props.row.status !== 'signed' && props.row.status !== 'voided'
              }
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  fireAndForget(
                    actions.markSignedOffline(packet()),
                    'contracts.mark-offline'
                  )
                }
              >
                {t('contracts.markSignedOffline')}
              </Button>
            </Show>
            <Show when={isInFlight(props.row.status)}>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  fireAndForget(actions.voidPacket(packet()), 'contracts.void')
                }
              >
                {t('contracts.void')}
              </Button>
            </Show>
          </Match>
        </Switch>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          class="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => replaceWith(event.currentTarget.files?.[0])}
        />
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <PacketSummary
          row={props.row}
          onOpenDocument={props.onOpenDocument}
          onSign={actions.openSigning}
          onCopyLink={(recipient) =>
            fireAndForget(
              actions.copySigningLink(recipient),
              'contracts.copy-link'
            )
          }
        />
      </div>
    </section>
  );
}
