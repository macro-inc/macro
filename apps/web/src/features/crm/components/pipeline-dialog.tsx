import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { NewPipeline } from '../core/pipeline';

/** One creation session; cancel preserves existing CRM data. */
export function PipelineDialog(props: {
  onCreate(input: NewPipeline): Promise<void>;
  onClose(): void;
}) {
  const [name, setName] = createSignal('');
  const [recordType, setRecordType] =
    createSignal<NewPipeline['recordType']>('company');
  const [sharing, setSharing] = createSignal<NewPipeline['sharing']>('private');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending() || !name().trim()) return;
    setPending(true);
    setError(false);
    try {
      await props.onCreate({
        name: name().trim(),
        recordType: recordType(),
        sharing: sharing(),
      });
      props.onClose();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      class="w-112 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <form onSubmit={submit} class="flex flex-col gap-4 p-5">
            <Dialog.Title class="text-base font-semibold">
              New pipeline
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              Track companies or contacts with columns you can customize.
            </Dialog.Description>
            <label class="flex flex-col gap-1.5 text-sm">
              Pipeline name
              <input
                required
                maxlength={200}
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                disabled={pending()}
                placeholder="e.g. Design partners"
                class="rounded-lg border border-edge-muted bg-input px-3 py-2 outline-none focus:border-accent"
              />
            </label>
            <fieldset disabled={pending()} class="flex flex-col gap-2 text-sm">
              <legend class="mb-2 font-medium">Track</legend>
              <label class="flex items-center gap-2">
                <input
                  type="radio"
                  name="recordType"
                  checked={recordType() === 'company'}
                  onChange={() => setRecordType('company')}
                />
                Companies
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="radio"
                  name="recordType"
                  checked={recordType() === 'contact'}
                  onChange={() => setRecordType('contact')}
                />
                Contacts
              </label>
            </fieldset>
            <fieldset disabled={pending()} class="flex flex-col gap-2 text-sm">
              <legend class="mb-2 font-medium">Share with</legend>
              <label class="flex items-center gap-2">
                <input
                  type="radio"
                  name="sharing"
                  checked={sharing() === 'private'}
                  onChange={() => setSharing('private')}
                />
                Just me
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="radio"
                  name="sharing"
                  checked={sharing() === 'team'}
                  onChange={() => setSharing('team')}
                />
                My team
              </label>
              <p class="text-xs text-ink-muted">
                You can change sharing later. Team members can edit shared
                pipelines.
              </p>
            </fieldset>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure-ink">
                Could not create this pipeline. Please try again.
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={pending()}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending() || !name().trim()}>
                {pending() ? 'Creating…' : 'Create pipeline'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
