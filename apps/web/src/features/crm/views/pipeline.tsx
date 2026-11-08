import { ViewSidebar } from '@app/components/view-shell';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import { ActionDialogShell } from '@ui/components/ActionDialogShell';
import { Button } from '@ui/components/Button';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Dialog } from '@ui/components/Dialog';
import { Dropdown } from '@ui/components/Dropdown';
import {
  createInlineRename,
  RenameInput,
  RenameTitle,
} from '@ui/components/InlineRename';
import { ResultAsync } from 'neverthrow';
import { createSignal, type JSX, Show } from 'solid-js';
import type {
  PipelineEditor,
  PipelineSharing,
  PipelinesSource,
  PipelineTransfer,
} from '../context/pipelines';
import { isTrackedPipeline, type Pipeline } from '../core/pipeline';
import { createPipelineExport } from '../primitives/pipeline-transfer';
import { PipelineImport } from './pipeline-import';

/** A pipeline's page: its name, sharing and actions above its one table. */
export function PipelineView(props: {
  pipeline: Pipeline;
  source: PipelinesSource;
  navigation?: JSX.Element;
  Editor: PipelineEditor;
  Sharing: PipelineSharing;
  onCopyLink(): void;
  /** After the pipeline moves to trash, leave its page. */
  onTrashed(): void;
  onOpenRecord?(record: { type: 'company' | 'contact'; id: string }): void;
  /** CSV export and import of the pipeline's entries, when the host offers them. */
  transfer?: {
    source: PipelineTransfer;
    downloadCsv(content: string, filename: string): Promise<{ saved: boolean }>;
  };
}) {
  const [pending, setPending] = createSignal(false);
  const [importing, setImporting] = createSignal(false);
  const [error, setError] = createSignal('');
  const [deleting, setDeleting] = createSignal(false);
  const [actionsOpen, setActionsOpen] = createSignal(false);
  let renameAfterMenuCloses = false;
  const canEdit = () => ['owner', 'edit'].includes(props.pipeline.grant);
  const isOwner = () => props.pipeline.grant === 'owner';
  const tracked = () =>
    isTrackedPipeline(props.pipeline) ? props.pipeline : undefined;
  // A host supplies one transfer for the page's lifetime.
  const transfer = props.transfer;
  const exporter =
    transfer &&
    createPipelineExport(
      () => props.pipeline,
      transfer.source,
      transfer.downloadCsv
    );
  const exportCsv = async () => {
    setError('');
    if ((await exporter?.run()) === 'failed')
      setError('Could not export this pipeline. Please try again.');
  };
  async function save(action: () => Promise<void>) {
    if (pending()) return false;
    setPending(true);
    setError('');
    try {
      await action();
      return true;
    } catch {
      setError('Could not save this change. Please try again.');
      return false;
    } finally {
      setPending(false);
    }
  }
  const pipelineRename = createInlineRename({
    key: (pipeline: Pipeline) => pipeline.id,
    name: (pipeline) => pipeline.name,
    rename: (pipeline, name) =>
      ResultAsync.fromPromise(
        props.source.rename(pipeline.id, name),
        () => 'Could not rename this pipeline. Please try again.'
      ),
    failureMessage: (message: string) => message,
  });
  const openActions = () => {
    setError('');
    setActionsOpen(true);
  };
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col touch:pb-[max(var(--safe-bottom,0px),var(--mobile-content-inset-bottom,0px))]">
      <Show when={!isTouchDevice()}>
        <div class="flex h-12 min-w-0 shrink-0 items-center gap-2 px-4">
          {props.navigation}
          <Show
            when={canEdit()}
            fallback={
              <ViewSidebar.Title caret={false} class="px-1">
                {props.pipeline.name}
              </ViewSidebar.Title>
            }
          >
            <span class="flex min-w-0 px-1">
              <RenameTitle
                rename={pipelineRename}
                target={props.pipeline}
                startOn="double-click"
                aria-label="Pipeline name"
                placeholder="Untitled pipeline"
                maxLength={200}
                class="text-sm font-semibold"
              />
            </span>
          </Show>
          <Show when={canEdit() || isOwner() || transfer}>
            <Dropdown placement="bottom-start">
              <Dropdown.Trigger
                variant="ghost"
                size="icon-md"
                aria-label="Pipeline actions"
                class="shrink-0"
                disabled={pending()}
              >
                <DotsThreeIcon class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content
                class="min-w-44"
                onCloseAutoFocus={() => {
                  if (!renameAfterMenuCloses) return;
                  renameAfterMenuCloses = false;
                  queueMicrotask(() => pipelineRename.begin(props.pipeline));
                }}
              >
                <Dropdown.Group>
                  <Show when={canEdit()}>
                    <Dropdown.Item
                      onSelect={() => (renameAfterMenuCloses = true)}
                    >
                      <PencilIcon class="size-4" />
                      Rename
                    </Dropdown.Item>
                  </Show>
                  <Show when={transfer}>
                    <Dropdown.Item
                      disabled={exporter?.pending()}
                      onSelect={() => fireAndForget(exportCsv(), 'crm')}
                    >
                      <DownloadIcon class="size-4" />
                      Export CSV
                    </Dropdown.Item>
                    <Show when={canEdit() && tracked()}>
                      <Dropdown.Item onSelect={() => setImporting(true)}>
                        <UploadIcon class="size-4" />
                        Import CSV
                      </Dropdown.Item>
                    </Show>
                  </Show>
                  <Show when={isOwner()}>
                    <Dropdown.Item onSelect={() => setDeleting(true)}>
                      <TrashIcon class="size-4" />
                      Trash pipeline
                    </Dropdown.Item>
                  </Show>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <HeaderActionGroup label="Sharing">
              <props.Sharing
                pipeline={props.pipeline}
                onCopyLink={props.onCopyLink}
              />
            </HeaderActionGroup>
          </div>
        </div>
      </Show>
      <Show when={error() && !actionsOpen()}>
        <p role="alert" class="px-4 pb-2 text-sm text-failure-ink">
          {error()}
        </p>
      </Show>
      <props.Editor
        pipeline={props.pipeline}
        onOpenRecord={props.onOpenRecord}
        actions={
          <Show when={isTouchDevice()}>
            <Button
              aria-label="Pipeline actions"
              tooltip="Pipeline actions"
              variant="ghost"
              size="icon-md"
              onClick={openActions}
            >
              <DotsThreeIcon class="size-4" />
            </Button>
          </Show>
        }
      />
      <Dialog
        open={actionsOpen()}
        onOpenChange={(open) => !pending() && setActionsOpen(open)}
        class="w-96 max-w-[calc(100vw-2rem)]"
      >
        <ActionDialogShell>
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                Pipeline actions
              </ActionDialogShell.Title>
            </ActionDialogShell.Header>
            <Show when={canEdit()}>
              <Show
                when={pipelineRename.isRenaming(props.pipeline)}
                fallback={
                  <Button
                    variant="ghost"
                    class="w-full justify-start"
                    onClick={() => pipelineRename.begin(props.pipeline)}
                  >
                    <PencilIcon class="size-4" />
                    Rename pipeline
                  </Button>
                }
              >
                <RenameInput
                  rename={pipelineRename}
                  aria-label="Pipeline name"
                  maxLength={200}
                  width="fill"
                />
              </Show>
            </Show>
            <Show when={transfer}>
              <Button
                variant="ghost"
                class="w-full justify-start"
                disabled={exporter?.pending()}
                onClick={() => fireAndForget(exportCsv(), 'crm')}
              >
                <DownloadIcon class="size-4" />
                Export CSV
              </Button>
              <Show when={canEdit() && tracked()}>
                <Button
                  variant="ghost"
                  class="w-full justify-start"
                  onClick={() => {
                    setActionsOpen(false);
                    setImporting(true);
                  }}
                >
                  <UploadIcon class="size-4" />
                  Import CSV
                </Button>
              </Show>
            </Show>
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm">Sharing</span>
              <props.Sharing
                pipeline={props.pipeline}
                onCopyLink={props.onCopyLink}
              />
            </div>
            <Show when={isOwner()}>
              <Button
                variant="danger"
                disabled={pending()}
                onClick={() => {
                  setActionsOpen(false);
                  setDeleting(true);
                }}
              >
                <TrashIcon class="size-4" />
                Trash pipeline
              </Button>
            </Show>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure-ink">
                {error()}
              </p>
            </Show>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              variant="ghost"
              disabled={pending()}
              onClick={() => setActionsOpen(false)}
            >
              Done
            </Button>
          </ActionDialogShell.Footer>
        </ActionDialogShell>
      </Dialog>
      <Show when={importing() && transfer}>
        {(current) => (
          <Show when={tracked()}>
            {(pipeline) => (
              <PipelineImport
                pipeline={pipeline()}
                transfer={current().source}
                onClose={() => setImporting(false)}
              />
            )}
          </Show>
        )}
      </Show>
      <DeleteDialog
        open={deleting()}
        onOpenChange={setDeleting}
        pending={pending()}
        title="Trash pipeline?"
        body={
          <p>
            The pipeline and its entries will move to trash.
            <Show when={tracked()}>
              {' '}
              The companies and contacts remain in your CRM.
            </Show>
          </p>
        }
        onDelete={() =>
          fireAndForget(
            save(async () => {
              await props.source.trash(props.pipeline.id);
              props.onTrashed();
            }),
            'crm'
          )
        }
      />
    </div>
  );
}
