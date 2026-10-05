import { Button, Dialog, Panel } from '@ui';
import { For, Show } from 'solid-js';
import { createCompanyImport } from '../primitives/import-companies';
import { useCreateCompanyMutation } from './use-crm';

export function CrmImport(props: { onClose: () => void }) {
  const create = useCreateCompanyMutation();
  const { rows, error, pending, completed, read, run } = createCompanyImport(
    (input) => create.mutateAsync(input)
  );
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
                variant="strong"
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
