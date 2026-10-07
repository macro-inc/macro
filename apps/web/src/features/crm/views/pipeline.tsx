import { Button } from '@ui';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { createSignal, type JSX, Show } from 'solid-js';
import type {
  PipelineEditor,
  PipelineSharing,
  PipelinesSource,
} from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';

export function PipelineView(props: {
  pipeline: Pipeline;
  source: PipelinesSource;
  navigation?: JSX.Element;
  Editor: PipelineEditor;
  Sharing: PipelineSharing;
  onCopyLink(): void;
  onBack(): void;
}) {
  const [draftName, setDraftName] = createSignal<string>();
  const name = () => draftName() ?? props.pipeline.name;
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [deleting, setDeleting] = createSignal(false);
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
  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-3 border-b border-edge-muted p-3">
        {props.navigation}
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          Back to companies
        </Button>
        <form
          class="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save(async () => {
              await props.source.rename(props.pipeline.id, name().trim());
              setDraftName(undefined);
            });
          }}
        >
          <input
            aria-label="Pipeline name"
            value={name()}
            maxlength={200}
            required
            disabled={
              pending() || !['owner', 'edit'].includes(props.pipeline.grant)
            }
            onInput={(event) => setDraftName(event.currentTarget.value)}
            class="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold outline-none focus:border-accent"
          />
          <Show when={name().trim() !== props.pipeline.name}>
            <Button
              size="sm"
              type="submit"
              disabled={pending() || !name().trim()}
            >
              Save name
            </Button>
          </Show>
        </form>
        <props.Sharing
          pipeline={props.pipeline}
          onCopyLink={props.onCopyLink}
        />
        <Show
          when={props.pipeline.grant === 'owner'}
          fallback={
            <span class="text-xs text-ink-muted">
              {props.pipeline.sharing === 'team'
                ? 'Shared with team'
                : 'Private'}
            </span>
          }
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={pending()}
            onClick={() => setDeleting(true)}
          >
            Trash pipeline
          </Button>
        </Show>
      </div>
      <Show when={error()}>
        <p role="alert" class="px-4 py-2 text-sm text-failure-ink">
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
            props.onBack();
          })
        }
      />
    </div>
  );
}
