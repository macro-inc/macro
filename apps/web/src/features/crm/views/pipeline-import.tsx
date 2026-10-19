import { fireAndForget } from '@core/util/fireAndForget';
import { Button, Dialog, Panel } from '@ui';
import { Show } from 'solid-js';
import type { PipelineTransfer } from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';
import { pipelineRecordHeaders } from '../core/pipeline-csv';
import { createPipelineImport } from '../primitives/pipeline-transfer';

const entries = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? 'entry' : 'entries'}`;

export function PipelineImport(props: {
  pipeline: Pipeline;
  transfer: PipelineTransfer;
  onClose: () => void;
}) {
  const { plan, error, reading, pending, resolved, result, read, run } =
    createPipelineImport(props.pipeline, props.transfer);
  const [name, key] = pipelineRecordHeaders(props.pipeline.recordType);
  const records = () =>
    props.pipeline.recordType === 'company' ? 'companies' : 'contacts';
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
              Import into {props.pipeline.name}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              Upload a CSV with a {key} column and, optionally, a {name} column,
              such as a pipeline export. Other columns fill the pipeline columns
              with the same name. Missing {records()} are added to your CRM.
            </Dialog.Description>
            <input
              aria-label="Pipeline CSV"
              type="file"
              accept=".csv,text/csv"
              disabled={reading() || pending()}
              onChange={(e) =>
                fireAndForget(read(e.currentTarget.files?.[0]), 'crm')
              }
              class="text-sm"
            />
            <Show when={plan()}>
              {(current) => (
                <div class="flex flex-col gap-1 text-sm">
                  <p>{entries(current().rows.length)} ready to import.</p>
                  <Show when={current().columns.length}>
                    <p class="text-ink-muted">
                      Fills {current().columns.join(', ')}.
                    </p>
                  </Show>
                  <Show when={current().ignored.length}>
                    <p class="text-ink-muted">
                      Skips columns this pipeline can't fill:{' '}
                      {current().ignored.join(', ')}.
                    </p>
                  </Show>
                  <Show when={current().skipped}>
                    <p class="text-ink-muted">
                      Skips {current().skipped.toLocaleString()} rows without a{' '}
                      {key.toLowerCase()}.
                    </p>
                  </Show>
                  <Show when={current().invalidCells}>
                    <p class="text-ink-muted">
                      Leaves {current().invalidCells.toLocaleString()} values
                      empty that don't fit their column.
                    </p>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={result()}>
              {(done) => (
                <p role="status" class="text-sm">
                  {entries(done().added)} added
                  <Show when={done().present}>
                    , {done().present.toLocaleString()} already in this pipeline
                  </Show>
                  <Show when={done().unresolved}>
                    , {done().unresolved.toLocaleString()} {records()} could not
                    be found or added to your CRM, such as personal domains like
                    gmail.com. Import again to retry them
                  </Show>
                  .
                </p>
              )}
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
                disabled={reading() || pending() || !plan()}
                onClick={() => fireAndForget(run(), 'crm')}
              >
                {pending()
                  ? `Importing… ${resolved().toLocaleString()} ${records()} matched`
                  : reading()
                    ? 'Reading…'
                    : 'Import'}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
