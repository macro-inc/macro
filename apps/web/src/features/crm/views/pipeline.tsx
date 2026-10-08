import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import PencilIcon from '@phosphor/pencil-line.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Dropdown } from '@ui/components/Dropdown';
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
  let title: HTMLSpanElement | undefined;
  const canEdit = () => ['owner', 'edit'].includes(props.pipeline.grant);
  const isOwner = () => props.pipeline.grant === 'owner';
  async function save(action: () => Promise<void>) {
    if (pending()) return;
    setPending(true);
    setError('');
    try {
      await action();
    } catch {
      setError('Could not save this change. Please try again.');
    } finally {
      setPending(false);
    }
  }
  const editTitle = () => {
    const input = title?.querySelector('input');
    input?.focus();
    input?.select();
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
      <Show when={error()}>
        <p role="alert" class="px-4 pb-2 text-sm text-failure-ink">
          {error()}
        </p>
      </Show>
      <props.Editor pipeline={props.pipeline} />
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
