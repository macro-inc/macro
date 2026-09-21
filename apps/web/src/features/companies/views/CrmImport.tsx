import { parseCsv } from '@core/util/csv';
import { useCreateCompanyMutation } from '@queries/crm/companies';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';

export function CrmImport(props: { onClose: () => void }) {
  const create = useCreateCompanyMutation();
  const [rows, setRows] = createSignal<{ name: string; domain: string }[]>([]);
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [completed, setCompleted] = createSignal(0);
  async function read(file?: File) {
    setError('');
    setRows([]);
    setCompleted(0);
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError('Choose a CSV smaller than 1 MB.');
      return;
    }
    try {
      const parsed = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const normalized = parsed.records.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key.toLowerCase(),
            value.trim(),
          ])
        )
      );
      if (
        !normalized.length ||
        normalized.length > 100 ||
        normalized.some(
          (row) =>
            !row.name ||
            !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(
              row.domain ?? ''
            )
        )
      ) {
        setError(
          'Use name and domain columns, with 1–100 companies and domains like acme.com.'
        );
        return;
      }
      setRows(
        normalized.map((row) => ({
          name: row.name,
          domain: row.domain.toLowerCase(),
        }))
      );
    } catch {
      setError('Could not read that file. Please try again.');
    }
  }
  async function run() {
    if (pending() || !rows().length) return;
    setPending(true);
    setError('');
    const failed: { name: string; domain: string }[] = [];
    for (const row of rows()) {
      try {
        await create.mutateAsync(row);
        setCompleted((n) => n + 1);
      } catch {
        failed.push(row);
      }
    }
    setRows(failed);
    setPending(false);
    if (failed.length)
      setError(
        `${failed.length} could not be imported. They may already exist or use an unsupported domain. Successful rows will not be retried.`
      );
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
              Import companies
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              Upload a CSV with name and domain columns. Review the companies
              before importing them into your team CRM.
            </Dialog.Description>
            <input
              aria-label="Companies CSV"
              type="file"
              accept=".csv,text/csv"
              disabled={pending()}
              onChange={(e) => void read(e.currentTarget.files?.[0])}
              class="text-sm"
            />
            <Show when={rows().length}>
              <div class="max-h-64 overflow-auto rounded-lg border border-edge-muted">
                <For each={rows()}>
                  {(row) => (
                    <div class="flex justify-between gap-3 border-b border-edge-muted px-3 py-2 text-sm last:border-0">
                      <span class="truncate">{row.name}</span>
                      <span class="text-ink-muted">{row.domain}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={completed()}>
              <p role="status" class="text-sm">
                {completed()} companies imported.
              </p>
            </Show>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={pending()}
                onClick={props.onClose}
              >
                Close
              </Button>
              <Button
                variant="accent"
                disabled={pending() || !rows().length}
                onClick={() => void run()}
              >
                {pending()
                  ? 'Importing…'
                  : `Import ${rows().length || ''} companies`}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
