import { t } from '@app/lib/i18n';
import { createMemo, For, Show } from 'solid-js';
import {
  ActivityList,
  DocumentThumbnail,
  PacketProperties,
  RecipientList,
  SectionHeading,
} from '../../components/packet-detail';
import { useContractsContext } from '../../context/contracts-context';
import { buildCertificate } from '../../core/certificate';
import { nextReminderAt } from '../../core/lifecycle';
import type { Packet, Recipient } from '../../core/packet';
import type { PacketRow } from '../../core/packet-row';
import { isInFlight } from '../../core/status';
import { createPacketPdfs } from '../../primitives/packet-pdfs';

/**
 * The body of a packet's drawer: its documents, where each recipient stands,
 * its properties, and its activity log.
 */
export function PacketSummary(props: {
  row: PacketRow;
  onOpenDocument: (packet: Packet, documentId: string) => void;
  onSign: (recipient: Recipient) => void;
  onCopyLink: (recipient: Recipient) => void;
}) {
  const context = useContractsContext();
  const packet = () => props.row.packet;
  const pdfs = createPacketPdfs(context.openDocument, () =>
    packet().documents.map((document) => document.id)
  );
  const certificate = createMemo(() => buildCertificate(packet()));
  const databases = () =>
    context
      .databases()
      .filter((database) => packet().databaseIds.includes(database.id));

  return (
    <div class="flex flex-col gap-6">
      <section class="flex flex-col gap-2.5">
        <SectionHeading>{t('contracts.documents')}</SectionHeading>
        <div class="flex flex-wrap gap-3.5">
          <For each={packet().documents}>
            {(document) => (
              <DocumentThumbnail
                document={document}
                pdf={pdfs.pdf(document.id)}
                selected={false}
                onOpen={() => props.onOpenDocument(packet(), document.id)}
              />
            )}
          </For>
        </div>
      </section>

      <section class="flex flex-col gap-1.5">
        <SectionHeading
          aside={
            <Show when={props.row.progress.total > 0}>
              {packet().signingOrder === 'sequential'
                ? t('contracts.sequentialProgress', {
                    signed: props.row.progress.signed,
                    count: props.row.progress.total,
                  })
                : t('contracts.parallelProgress', {
                    signed: props.row.progress.signed,
                    count: props.row.progress.total,
                  })}
            </Show>
          }
        >
          {t('contracts.recipients')}
        </SectionHeading>
        <RecipientList
          packet={packet()}
          inFlight={isInFlight(props.row.status)}
          onSign={props.onSign}
          onCopyLink={props.onCopyLink}
        />
      </section>

      <section class="flex flex-col gap-1">
        <SectionHeading>{t('contracts.properties')}</SectionHeading>
        <PacketProperties
          packet={packet()}
          databases={databases()}
          nextReminderAt={
            isInFlight(props.row.status) ? nextReminderAt(packet()) : undefined
          }
        />
      </section>

      <section class="flex flex-col gap-2">
        <SectionHeading>{t('contracts.activity')}</SectionHeading>
        <ActivityList events={certificate().events} />
      </section>
    </div>
  );
}
