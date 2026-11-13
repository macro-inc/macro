import { t } from '@app/lib/i18n';
import { Dialog, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { PdfPage } from '../../components/pdf-page';
import { FilledField } from '../../components/signing-field';
import { useContractsContext } from '../../context/contracts-context';
import { findRecipient, type Packet } from '../../core/packet';
import { createPacketPdfs } from '../../primitives/packet-pdfs';

/** A packet's documents as they read now, with signed fields filled in. */
export function DocumentDialog(props: {
  packet: Packet;
  documentId: string;
  onClose: () => void;
}) {
  const context = useContractsContext();
  const [documentId, setDocumentId] = createSignal(props.documentId);
  const pdfs = createPacketPdfs(context.openDocument, () =>
    props.packet.documents.map((document) => document.id)
  );
  const pages = () =>
    Array.from({ length: pdfs.pdf(documentId())?.pageCount ?? 0 }, (_, i) => i);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="flex h-[90dvh] w-200 max-w-[calc(100vw-2rem)] flex-col"
      visibleScrim
    >
      <div class="flex shrink-0 items-center gap-3 px-5 pt-4 pb-3">
        <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-medium">
          {props.packet.title}
        </Dialog.Title>
        <Dialog.CloseButton />
      </div>
      <Show when={props.packet.documents.length > 1}>
        <div class="shrink-0 px-5 pb-3">
          <Tabs
            aria-label={t('contracts.documents')}
            variant="pills"
            options={props.packet.documents.map((document) => ({
              value: document.id,
              label: document.name,
            }))}
            value={documentId()}
            onChange={setDocumentId}
          />
        </div>
      </Show>
      <div class="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto px-5 pb-5">
        <Show
          when={pdfs.pdf(documentId())}
          fallback={
            <p role="status" class="p-8 text-sm text-ink-muted">
              {pdfs.failed().includes(documentId())
                ? t('contracts.documentUnreadable')
                : t('contracts.loadingDocument')}
            </p>
          }
        >
          {(pdf) => (
            <For each={pages()}>
              {(page) => (
                <PdfPage
                  pdf={pdf()}
                  page={page}
                  class="max-w-170 shrink-0 rounded-xl"
                  label={t('contracts.pageLabel', {
                    page: page + 1,
                    total: pdf().pageCount,
                  })}
                >
                  <For
                    each={props.packet.fields.filter(
                      (field) =>
                        field.documentId === documentId() && field.page === page
                    )}
                  >
                    {(field) => (
                      <Show
                        when={findRecipient(props.packet, field.recipientId)}
                      >
                        {(recipient) => (
                          <FilledField field={field} recipient={recipient()} />
                        )}
                      </Show>
                    )}
                  </For>
                </PdfPage>
              )}
            </For>
          )}
        </Show>
      </div>
    </Dialog>
  );
}
