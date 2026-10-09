import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import PencilIcon from '@phosphor/pencil-line.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import { ActionDialogShell } from '@ui/components/ActionDialogShell';
import { Button } from '@ui/components/Button';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Dialog } from '@ui/components/Dialog';
import { Dropdown } from '@ui/components/Dropdown';
import { Input } from '@ui/components/Input';
import { createSignal, type JSX, Show } from 'solid-js';
import type {
  PipelineEditor,
  PipelineSharing,
  PipelinesSource,
} from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';

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
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [deleting, setDeleting] = createSignal(false);
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [name, setName] = createSignal('');
  let title: HTMLSpanElement | undefined;
  let mobileNameInput: HTMLInputElement | undefined;
  const canEdit = () => ['owner', 'edit'].includes(props.pipeline.grant);
  const isOwner = () => props.pipeline.grant === 'owner';
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
  const editTitle = () => {
    const input = title?.querySelector('input');
    input?.focus();
    input?.select();
  };
  const openActions = () => {
    setName(props.pipeline.name);
    setError('');
    setRenaming(false);
    setActionsOpen(true);
  };
  const startRenaming = () => {
    setRenaming(true);
    queueMicrotask(() => {
      mobileNameInput?.focus();
      mobileNameInput?.select();
    });
  };
  const rename = async (event: SubmitEvent) => {
    event.preventDefault();
    const nextName = name().trim();
    if (!canEdit() || !nextName || nextName === props.pipeline.name) return;
    if (await save(() => props.source.rename(props.pipeline.id, nextName))) {
      setActionsOpen(false);
    }
  };
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col touch:pb-[max(var(--safe-bottom,0px),var(--mobile-content-inset-bottom,0px))]">
      <Show when={!isTouchDevice()}>
        <div class="flex h-12 min-w-0 shrink-0 items-center gap-2 px-4">
          {props.navigation}
          <Show
            when={canEdit()}
            fallback={
              <h1 class="min-w-0 truncate px-1 text-sm font-semibold">
                {props.pipeline.name}
              </h1>
            }
          >
            <span ref={title} class="flex min-w-0 px-1">
              <InlineTitleEditor
                value={props.pipeline.name}
                placeholder="Untitled pipeline"
                ariaLabel="Pipeline name"
                class="text-sm"
                onRename={(name) =>
                  void save(() => props.source.rename(props.pipeline.id, name))
                }
              />
            </span>
          </Show>
          <Show when={canEdit() || isOwner()}>
            <Dropdown placement="bottom-start">
              <Dropdown.Trigger
                variant="ghost"
                size="icon-sm"
                aria-label="Pipeline actions"
                class="shrink-0"
                disabled={pending()}
              >
                <DotsThreeIcon class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-44">
                <Show when={canEdit()}>
                  <Dropdown.Item onSelect={() => queueMicrotask(editTitle)}>
                    <PencilIcon class="size-4" />
                    Rename
                  </Dropdown.Item>
                </Show>
                <Show when={isOwner()}>
                  <Dropdown.Item onSelect={() => setDeleting(true)}>
                    <TrashIcon class="size-4" />
                    Trash pipeline
                  </Dropdown.Item>
                </Show>
              </Dropdown.Content>
            </Dropdown>
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <props.Sharing
              pipeline={props.pipeline}
              onCopyLink={props.onCopyLink}
            />
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
        actions={
          <Show when={isTouchDevice()}>
            <Button
              variant="ghost"
              size="icon-md"
              label="Pipeline actions"
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
                when={renaming()}
                fallback={
                  <Button
                    variant="ghost"
                    class="w-full justify-start"
                    onClick={startRenaming}
                  >
                    <PencilIcon class="size-4" />
                    Rename pipeline
                  </Button>
                }
              >
                <form
                  class="flex flex-col gap-3"
                  onSubmit={(event) => void rename(event)}
                >
                  <label class="flex flex-col gap-1.5 text-sm">
                    Pipeline name
                    <Input
                      ref={mobileNameInput}
                      value={name()}
                      onInput={(event) => setName(event.currentTarget.value)}
                      disabled={pending()}
                      maxlength={200}
                      required
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      pending() ||
                      !name().trim() ||
                      name().trim() === props.pipeline.name
                    }
                  >
                    Save name
                  </Button>
                </form>
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
      <DeleteDialog
        open={deleting()}
        onOpenChange={setDeleting}
        pending={pending()}
        title="Trash pipeline?"
        body={
          <p>
            The pipeline and its entries will move to trash. The companies and
            contacts remain in your CRM.
          </p>
        }
        onDelete={() =>
          void save(async () => {
            await props.source.trash(props.pipeline.id);
            props.onTrashed();
          })
        }
      />
    </div>
  );
}
