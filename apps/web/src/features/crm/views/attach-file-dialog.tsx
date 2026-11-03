import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, Dialog, Input, Panel, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { FileTypeSelect } from '../components/file-type-select';
import type { FileTypesSource } from '../context/file-types';
import type { CrmRecordTarget } from '../core/record';
import { createFileAttachment } from '../primitives/file-attachment';

export function AttachFileDialog(props: {
  source: FileTypesSource;
  record: CrmRecordTarget;
  onClose(): void;
  onOpenCreated(id: string): void;
}) {
  const [mode, setMode] = createSignal<'attach' | 'create'>('attach');
  const [name, setName] = createSignal('');
  const [selected, setSelected] = createSignal<string>();
  const [visibleCount, setVisibleCount] = createSignal(50);
  const [typeId, setTypeId] = createSignal<string | null>(null);
  const candidates = props.source.candidates(name);
  const editor = createFileAttachment(props.source, props.record);
  const editable = props.source.canEdit(() => selected() ?? '');
  const enabled = () =>
    mode() === 'create' ? !!name().trim() : !!selected() && editable();
  async function save() {
    if (!enabled()) return;
    const success = await editor.save({
      name: name().trim(),
      documentId: mode() === 'attach' ? selected() : undefined,
      typeId: typeId(),
    });
    if (success) props.onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !editor.pending() && props.onClose()}
      class="w-112 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <div class="flex flex-col gap-4 p-5">
            <Dialog.Title class="text-base font-semibold">
              {t('crmFiles.addFile')}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              {t('crmFiles.attachDescription')}
            </Dialog.Description>
            <Show when={!editor.createdId()}>
              <Tabs<'attach' | 'create'>
                aria-label={t('crmFiles.addFileMode')}
                disabled={editor.pending()}
                value={mode()}
                onChange={(value) => {
                  setMode(value);
                  setSelected(undefined);
                  setName('');
                }}
                options={[
                  { value: 'attach', label: t('crmFiles.existingFile') },
                  { value: 'create', label: t('crmFiles.newNote') },
                ]}
              />
            </Show>
            <Input
              aria-label={
                mode() === 'create'
                  ? t('crmFiles.fileName')
                  : t('crmFiles.findFile')
              }
              placeholder={
                mode() === 'create'
                  ? t('crmFiles.fileName')
                  : t('crmFiles.findFilePlaceholder')
              }
              value={name()}
              onInput={(event) => {
                setName(event.currentTarget.value);
                setSelected(undefined);
                setVisibleCount(50);
              }}
              disabled={editor.pending() || !!editor.createdId()}
            />
            <Show when={mode() === 'attach'}>
              <div
                class="max-h-60 overflow-auto"
                aria-label={t('crmFiles.filesToAttach')}
              >
                <For each={candidates.files().slice(0, visibleCount())}>
                  {(file) => (
                    <Button
                      variant="ghost"
                      fullWidth
                      aria-pressed={selected() === file.id}
                      disabled={editor.pending()}
                      onClick={() => setSelected(file.id)}
                    >
                      {file.name}
                    </Button>
                  )}
                </For>
                <Show when={candidates.error()}>
                  <p role="alert" class="p-3 text-sm text-failure">
                    {t('crmFiles.loadFailed')}
                  </p>
                </Show>
                <Show
                  when={
                    candidates.files().length > visibleCount() ||
                    candidates.hasMore()
                  }
                >
                  <Button
                    variant="ghost"
                    disabled={editor.pending() || candidates.pending()}
                    onClick={() => {
                      if (candidates.files().length > visibleCount())
                        setVisibleCount((count) => count + 50);
                      else fireAndForget(candidates.loadMore(), 'crm-files');
                    }}
                  >
                    {t('crmFiles.moreFiles')}
                  </Button>
                </Show>
                <Show when={candidates.files().length === 0}>
                  <p class="p-3 text-sm text-ink-muted">
                    {candidates.pending()
                      ? t('crmFiles.loadingFiles')
                      : t('crmFiles.noMatchingFiles')}
                  </p>
                </Show>
              </div>
              <Show when={selected() && !editable()}>
                <p class="text-sm text-ink-muted">
                  {t('crmFiles.editRequired')}
                </p>
              </Show>
            </Show>
            <FileTypeSelect
              options={props.source.data()?.options ?? []}
              value={typeId()}
              onChange={setTypeId}
              emptyLabel={
                mode() === 'attach'
                  ? t('crmFiles.keepType')
                  : t('crmFiles.unclassified')
              }
              disabled={editor.pending()}
            />
            <Show when={editor.error()}>
              {(error) => (
                <p role="alert" class="text-sm text-failure">
                  {t(`crmFiles.${error()}`)}
                </p>
              )}
            </Show>
            <Show when={editor.createdId()}>
              {(id) => (
                <Button
                  variant="ghost"
                  onClick={() => props.onOpenCreated(id())}
                >
                  {t('crmFiles.openCreated')}
                </Button>
              )}
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={editor.pending()}
                onClick={props.onClose}
              >
                {t('common.cancel')}
              </Button>
              <Button
                disabled={editor.pending() || !enabled()}
                onClick={() => fireAndForget(save(), 'crm-files')}
              >
                {editor.pending()
                  ? t('crmFiles.saving')
                  : editor.createdId()
                    ? t('crmFiles.retry')
                    : mode() === 'create'
                      ? t('crmFiles.createAndAttach')
                      : t('crmFiles.attachFile')}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
