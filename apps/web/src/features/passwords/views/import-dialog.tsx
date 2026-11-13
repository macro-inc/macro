import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel } from '@ui';
import { Match, onCleanup, Show, Switch } from 'solid-js';
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
  items: () => PasswordItem[];
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
  const busy = () => {
    const current = step().step;
    return current === 'parsing' || current === 'importing';
  };
  return (
    <Dialog
      open
      fullscreen={isMobile()}
      position="center"
      class="w-[36rem] max-w-[calc(100vw-2rem)] mobile:w-full mobile:max-w-none"
      onOpenChange={(open) => {
        if (!open && !busy()) props.onClose();
      }}
    >
      <Panel
        depth={2}
        class="flex max-h-[min(44rem,calc(var(--dvh,1dvh)*100-4rem))] flex-col rounded-xl mobile:h-full mobile:max-h-none mobile:rounded-none mobile:pt-(--safe-top,0px)"
        data-passwords-import
      >
        <Panel.Header class="flex items-center gap-2 px-6">
          <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('passwords.importTitle')}
          </Dialog.Title>
          <Show when={!busy()}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('passwords.cancel')}
              tooltip={t('passwords.cancel')}
              onClick={props.onClose}
            >
              <XIcon class="size-4" />
            </Button>
          </Show>
        </Panel.Header>
        <Panel.Body class="min-h-0 flex-1 overflow-auto p-6 font-sans">
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
              <p class="text-sm text-ink-muted" aria-live="polite">
                {t('passwords.importReading')}
              </p>
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
          <div class="flex flex-wrap items-center justify-end gap-2 border-t border-edge-muted px-6 py-3 mobile:pb-[calc(var(--safe-bottom,0px)+0.75rem)]">
            <Switch>
              <Match when={step().step === 'preview'}>
                <Button variant="ghost" size="sm" onClick={controller.reset}>
                  {t('passwords.importChooseAnother')}
                </Button>
                <Show
                  when={controller.sendCount() > 0}
                  fallback={
                    <Button variant="primary" size="sm" onClick={props.onClose}>
                      {t('passwords.importClose')}
                    </Button>
                  }
                >
                  <Button
                    variant="primary"
                    size="sm"
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={controller.reset}
                    >
                      {t('passwords.importAnother')}
                    </Button>
                    <Show
                      when={result().targetFolderId}
                      fallback={
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={props.onClose}
                        >
                          {t('passwords.importClose')}
                        </Button>
                      }
                    >
                      {(folderId) => (
                        <Button
                          variant="primary"
                          size="sm"
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
          </div>
        </Show>
      </Panel>
    </Dialog>
  );
}
