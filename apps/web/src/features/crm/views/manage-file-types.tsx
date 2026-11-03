import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { Button, Dialog, Input, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { FileTypesSource } from '../context/file-types';
import type { FileTypeOption } from '../core/file-types';

export function ManageFileTypes(props: {
  source: FileTypesSource;
  onClose(): void;
}) {
  const [name, setName] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  async function run(action: () => Promise<void>) {
    if (pending()) return;
    setPending(true);
    setError(false);
    const result = await catchToResult(action);
    setError(result.isErr());
    setPending(false);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      class="w-112 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <div class="flex flex-col gap-4 p-5">
            <Dialog.Title class="text-base font-semibold">
              {t('crmFiles.fileTypes')}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              {t('crmFiles.manageDescription')}
            </Dialog.Description>
            <For each={props.source.data()?.options}>
              {(option) => (
                <FileTypeRow
                  option={option}
                  pending={pending()}
                  onRename={(name) =>
                    run(() => props.source.rename(option.id, name))
                  }
                  onRemove={() => run(() => props.source.remove(option.id))}
                />
              )}
            </For>
            <div class="flex items-center gap-2">
              <Input
                aria-label={t('crmFiles.newFileType')}
                placeholder={t('crmFiles.newFileType')}
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                disabled={pending()}
              />
              <Button
                variant="outline"
                disabled={pending() || !name().trim()}
                onClick={() =>
                  fireAndForget(
                    run(async () => {
                      await props.source.add(name().trim());
                      setName('');
                    }),
                    'crm-files'
                  )
                }
              >
                {t('crmFiles.add')}
              </Button>
            </div>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {t('crmFiles.saveTypesFailed')}
              </p>
            </Show>
            <Button
              variant="outline"
              disabled={pending()}
              onClick={props.onClose}
            >
              {t('crmFiles.done')}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

function FileTypeRow(props: {
  option: FileTypeOption;
  pending: boolean;
  onRename(name: string): Promise<void>;
  onRemove(): Promise<void>;
}) {
  const [name, setName] = createSignal(props.option.name);
  const [confirm, setConfirm] = createSignal(false);
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <Input
          aria-label={t('crmFiles.renameType', { name: props.option.name })}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          disabled={props.pending}
        />
        <Button
          variant="ghost"
          disabled={
            props.pending ||
            !name().trim() ||
            name().trim() === props.option.name
          }
          onClick={() =>
            fireAndForget(props.onRename(name().trim()), 'crm-files')
          }
        >
          {t('crmFiles.save')}
        </Button>
        <Button
          variant="ghost"
          disabled={props.pending}
          onClick={() => setConfirm(true)}
        >
          {t('crmFiles.remove')}
        </Button>
      </div>
      <Show when={confirm()}>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {t('crmFiles.confirmRemove', { name: props.option.name })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={props.pending}
            onClick={() => fireAndForget(props.onRemove(), 'crm-files')}
          >
            {t('crmFiles.removeType')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={() => setConfirm(false)}
          >
            {t('common.cancel')}
          </Button>
        </div>
      </Show>
    </div>
  );
}
