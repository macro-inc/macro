import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel, Spinner } from '@ui';
import { createEffect, Match, onCleanup, Show, Switch } from 'solid-js';
import {
  ImportFilePicker,
  ImportPreviewStep,
  ImportProgressStep,
  ImportResultStep,
} from '../components/import-steps';
import type { PasswordFolder, PasswordItem } from '../core/types';
import { createPasswordImport } from '../primitives/import';

/**
 * Import from 1Password or Bitwarden: choose a file, preview, import, result.
 * A full-screen sheet on phones. Mounted only while open, so each opening
 * starts fresh and closing drops the parsed export.
 */
export function ImportDialog(props: {
  /** The vault list; undefined while it is unavailable. */
  items: () => PasswordItem[] | undefined;
  folders: () => PasswordFolder[];
  refresh: () => Promise<void>;
  onOpenFolder: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const controller = createPasswordImport({
    items: props.items,
    folders: props.folders,
    refresh: props.refresh,
  });
  onCleanup(controller.close);
  const step = controller.step;
  // Closing mid-import would drop the batches not yet sent.
  const importing = () => step().step === 'importing';
  // Leaving the page mid-import stops it: ask first, only while it runs.
  createEffect(() => {
    if (!importing()) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    onCleanup(() => window.removeEventListener('beforeunload', warn));
  });
  return (
    <Dialog
      open
      fullscreen={isMobile()}
      position="center"
      class="w-[36rem] max-w-[calc(100vw-2rem)] mobile:w-full mobile:max-w-none"
      onOpenChange={(open) => {
        if (!open && !importing()) props.onClose();
      }}
    >
      <Panel
        depth={2}
        class="max-h-[min(44rem,calc(var(--dvh,1dvh)*100-4rem))] rounded-xl text-ink mobile:h-full mobile:max-h-none mobile:rounded-none mobile:pt-(--safe-top,0px)"
        data-passwords-import
      >
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            aria-label={t('passwords.cancel')}
            disabled={importing()}
          >
            <XIcon class="pointer-events-none size-3.5 shrink-0 touch:size-6" />
          </Dialog.CloseButton>
          <Dialog.Title
            as="span"
            class="m-0 min-w-0 truncate p-0 text-sm font-medium"
          >
            {t('passwords.importTitle')}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll class="p-3 font-sans">
          <Switch>
            <Match when={step().step === 'choose'}>
              <ImportFilePicker
                failure={controller.chooseFailure()}
                onFile={(file) =>
                  fireAndForget(controller.choose(file), 'passwords-import')
                }
              />
            </Match>
            <Match when={step().step === 'parsing'}>
              <div
                class="flex min-h-40 flex-col items-center justify-center gap-3"
                aria-live="polite"
                data-passwords-import-reading
              >
                <Spinner decorative />
                <p class="text-sm text-ink-muted">
                  {t('passwords.importReading')}
                </p>
              </div>
            </Match>
            <Match when={step().step === 'preview'}>
              <Show when={controller.preview()}>
                {(preview) => (
                  <ImportPreviewStep
                    preview={preview()}
                    vaultFolders={props.folders()}
                    destination={controller.destination()}
                    onDestination={controller.setDestination}
                    skipDuplicates={controller.skipDuplicates()}
                    onSkipDuplicates={controller.setSkipDuplicates}
                    makePrivate={controller.makePrivate()}
                    onPrivate={controller.setMakePrivate}
                    folderCheck={controller.folderCheck()}
                  />
                )}
              </Show>
            </Match>
            <Match when={controller.progress()}>
              {(progress) => (
                <ImportProgressStep
                  done={progress().done}
                  total={progress().total}
                />
              )}
            </Match>
            <Match when={controller.result()}>
              {(result) => <ImportResultStep {...result().tally} />}
            </Match>
          </Switch>
        </Panel.Body>
        <Show when={step().step === 'preview' || step().step === 'result'}>
          <Panel.Footer class="flex-wrap justify-end gap-1 py-2 mobile:pb-[calc(var(--safe-bottom,0px)+0.5rem)]">
            <Switch>
              <Match when={step().step === 'preview'}>
                <Button variant="ghost" onClick={controller.reset}>
                  {t('passwords.importChooseAnother')}
                </Button>
                <Show
                  when={controller.sendCount() > 0}
                  fallback={
                    <Button variant="primary" onClick={props.onClose}>
                      {t('passwords.importClose')}
                    </Button>
                  }
                >
                  <Button
                    variant="primary"
                    disabled={
                      controller.folderCheck()?.tooMany ||
                      controller.folderCheck()?.tooDeep
                    }
                    onClick={() =>
                      fireAndForget(controller.start(), 'passwords-import')
                    }
                  >
                    {t('passwords.importStart', {
                      count: controller.sendCount(),
                    })}
                  </Button>
                </Show>
              </Match>
              <Match when={controller.result()}>
                {(result) => (
                  <>
                    <Button variant="ghost" onClick={controller.reset}>
                      {t('passwords.importAnother')}
                    </Button>
                    <Show
                      when={result().targetFolderId}
                      fallback={
                        <Button variant="primary" onClick={props.onClose}>
                          {t('passwords.importClose')}
                        </Button>
                      }
                    >
                      {(folderId) => (
                        <Button
                          variant="primary"
                          onClick={() => props.onOpenFolder(folderId())}
                        >
                          {t('passwords.importOpenFolder')}
                        </Button>
                      )}
                    </Show>
                  </>
                )}
              </Match>
            </Switch>
          </Panel.Footer>
        </Show>
      </Panel>
    </Dialog>
  );
}
