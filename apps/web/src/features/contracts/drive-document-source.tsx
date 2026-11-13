import { t } from '@app/lib/i18n';
import { fetchBinaryDocumentData } from '@app/lib/queries/storage/binary-document';
import { fireAndForget } from '@core/util/fireAndForget';
import FolderIcon from '@icon/system/regular/folder.svg';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { Button, Dialog } from '@ui';
import { ResultAsync } from 'neverthrow';
import { createSignal, Show, Suspense } from 'solid-js';
import type { DocumentSource } from './context/contracts-context';

type Chosen = { id: string; name: string };

/** A Drive document's bytes as a file named after it. */
function fetchDriveFile(document: Chosen): ResultAsync<File, undefined> {
  const load = async (): Promise<File> => {
    const data = await fetchBinaryDocumentData(document.id);
    if (data.isErr()) throw new Error('The document has no file to fetch');
    const bytes = await fetchBinary(data.value.blobUrl, 'arraybuffer');
    if (bytes.isErr()) throw new Error('The document could not be fetched');

    const { documentName, fileType } = data.value.documentMetadata;
    const name = fileType ? `${documentName}.${fileType}` : documentName;
    return new File([bytes.value], name);
  };
  return ResultAsync.fromPromise(load(), () => undefined);
}

/**
 * Choose documents from Macro Drive for a packet. The picker lists the
 * viewer's documents; each chosen one is fetched and handed over as a file,
 * and the packet's own import decides whether it is a PDF it can use.
 */
export const DriveDocumentSource: DocumentSource = (props) => {
  const [open, setOpen] = createSignal(false);
  const [chosen, setChosen] = createSignal<Chosen[]>([]);
  const [adding, setAdding] = createSignal(false);

  function close() {
    setOpen(false);
    setChosen([]);
  }

  async function add() {
    setAdding(true);
    for (const document of chosen()) {
      const file = await fetchDriveFile(document);
      if (file.isOk()) props.onFile(file.value);
      else props.onUnavailable(document.name);
    }
    setAdding(false);
    close();
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        <FolderIcon class="size-3.5" />
        {t('contracts.chooseFromDrive')}
      </Button>
      <Show when={open()}>
        <Dialog
          open
          onOpenChange={(next) => !next && close()}
          position="center"
          class="flex w-120 max-w-[calc(100vw-2rem)] flex-col gap-3 p-4"
          visibleScrim
        >
          <Dialog.Title class="text-base font-semibold tracking-tight">
            {t('contracts.chooseFromDrive')}
          </Dialog.Title>
          <p class="text-sm text-ink-muted">{t('contracts.driveHint')}</p>
          <Suspense
            fallback={
              <p role="status" class="p-3 text-sm text-ink-muted">
                {t('contracts.loadingDocument')}
              </p>
            }
          >
            <div class="overflow-hidden rounded-lg border border-edge-muted">
              <PropertyEntitySelector
                config={{
                  isMultiSelect: true,
                  placeholder: t('contracts.driveSearch'),
                  emptyMessage: t('contracts.driveEmpty'),
                  specificEntityType: 'DOCUMENT',
                  visibleCheckboxes: true,
                }}
                selectedOptions={() =>
                  new Set(chosen().map((document) => document.id))
                }
                setSelectedOptions={(ids, entities) => {
                  // The selector names the rows it knows; an id it does not
                  // name keeps the name it was chosen under.
                  const known = new Map(
                    [...chosen(), ...(entities ?? [])].map((entity) => [
                      entity.id,
                      entity.name,
                    ])
                  );
                  setChosen(
                    [...ids].map((id) => ({ id, name: known.get(id) ?? '' }))
                  );
                }}
              />
            </div>
          </Suspense>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {t('contracts.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={chosen().length === 0}
              loading={adding()}
              onClick={() => fireAndForget(add(), 'contracts.drive-import')}
            >
              {t('contracts.driveAdd', { count: chosen().length })}
            </Button>
          </div>
        </Dialog>
      </Show>
    </>
  );
};
