import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import FolderIcon from '@icon/system/regular/folder.svg';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button, Dialog } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import type { DocumentSource } from './context/contracts-context';
import { fetchDrivePdf } from './queries/drive-file';

type Chosen = { id: string; name: string };

/**
 * Choose documents from Macro Drive for a packet. The picker lists the
 * viewer's documents; each chosen PDF is fetched and handed over as a file,
 * in the order chosen, and anything else is refused by name.
 */
export const DriveDocumentSource: DocumentSource = (props) => {
  const [open, setOpen] = createSignal(false);
  const [chosen, setChosen] = createSignal<Chosen[]>([]);
  const [adding, setAdding] = createSignal(false);

  /** Close the picker. It stays open while chosen documents are added. */
  function close() {
    if (adding()) return;
    setOpen(false);
    setChosen([]);
  }

  async function add() {
    setAdding(true);
    // Fetched together, handed over one at a time: the packet lists them in
    // the order they were chosen, and the picker closes only once the packet
    // has taken every one.
    const documents = chosen();
    const files = await Promise.all(
      documents.map((document) => fetchDrivePdf(document.id))
    );
    for (const [index, file] of files.entries()) {
      if (file.isOk()) await props.onFile(file.value);
      else props.onRejected(documents[index].name, file.error);
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
                // Escape in the search field closes the picker, as it does
                // anywhere else in the dialog.
                onClose={close}
                onCancel={close}
              />
            </div>
          </Suspense>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" disabled={adding()} onClick={close}>
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
