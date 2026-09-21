import type { ImportDatabaseTableRequest } from '@service-storage/databases';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Input } from '@ui/components/Input';
import { Panel } from '@ui/components/Panel';
import { createSignal, For, Show } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import type { DatabaseCsv } from '../core/csv';

export function CsvImportDialog(props: {
  data: DatabaseCsv;
  initialName: string;
  onImport: (request: ImportDatabaseTableRequest) => Promise<void>;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  const [name, setName] = createSignal(props.initialName);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [request, setRequest] = createSignal<ImportDatabaseTableRequest>();
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending() || !name().trim()) return;
    const attempt = request() ?? {
      requestId: uuidv7(),
      name: name().trim(),
      ...props.data,
    };
    setRequest(attempt);
    setPending(true);
    setError('');
    try {
      await props.onImport(attempt);
      props.onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not import the CSV. Please try again.'
      );
      // A validation refusal has no committed table. Transport failures retain
      // the original request and name so a retry cannot duplicate an import.
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_SCHEMA'
      )
        setRequest(undefined);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      class="w-140 max-w-[calc(100vw-2rem)]"
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      onCloseAutoFocus={(event) => {
        if (props.returnFocus?.isConnected) {
          event.preventDefault();
          props.returnFocus.focus();
        }
      }}
    >
      <Panel>
        <Panel.Body>
          <form class="flex min-w-0 flex-col gap-4 p-5" onSubmit={submit}>
            <div>
              <Dialog.Title class="text-base font-semibold">
                Import CSV
              </Dialog.Title>
              <Dialog.Description class="mt-1 text-sm text-ink-muted">
                {props.data.rows.length.toLocaleString()} rows ·{' '}
                {props.data.columns.length} columns
              </Dialog.Description>
            </div>
            <label class="flex flex-col gap-1.5 text-sm">
              Table name
              <Input
                value={name()}
                onFocus={(event) => event.currentTarget.select()}
                maxLength={200}
                disabled={pending() || !!request()}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <div class="max-h-56 overflow-auto rounded-md border border-edge-muted">
              <table class="w-full border-collapse text-left text-xs">
                <thead class="bg-canvas-base text-ink-muted">
                  <tr>
                    <For each={props.data.columns}>
                      {(column) => (
                        <th class="max-w-48 truncate border-b border-edge-muted px-3 py-2 font-medium">
                          {column}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.data.rows.slice(0, 5)}>
                    {(row) => (
                      <tr>
                        <For each={row}>
                          {(value) => (
                            <td
                              class="max-w-48 truncate border-b border-edge-muted px-3 py-2 last:border-r-0"
                              title={value}
                            >
                              {value || '\u00a0'}
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={error()}>
              <p class="text-sm text-failure" role="alert">
                {error()}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending()}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                disabled={pending() || !name().trim()}
              >
                {pending()
                  ? 'Importing…'
                  : request()
                    ? 'Retry import'
                    : 'Import'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
