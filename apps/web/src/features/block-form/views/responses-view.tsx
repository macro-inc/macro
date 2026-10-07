import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import ClipboardText from '@phosphor/clipboard-text.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { StatTiles } from '../components/responses/stat-tiles';
import { useFormContext } from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { sectionName } from '../core/layout-messages';
import { type ChannelReach, responseTiles } from '../core/response-stats';

/**
 * The Responses tab (RFC 02 §5): the linked table's own grid, embedded, with
 * the ledger's counts above it. Every row of the table shows, not only this
 * form's: filtering would hide data from the people who own it.
 */
export function ResponsesView(props: {
  detail: FormDetail;
  onOpenDatabase: (databaseId: string) => void;
}) {
  const context = useFormContext();
  const form = () => props.detail.form;
  const table = context.createTableSource(
    () => props.detail.form.databaseId,
    () => props.detail.form.tableId
  );
  const summary = context.responses.createSummary(
    () => props.detail.form.id,
    () => props.detail.access !== 'view'
  );
  const invited = context.responses.createInvited(
    () => props.detail.form.id,
    () => props.detail.form.ownerId,
    () => props.detail.access === 'owner'
  );
  // Sharing is owner-only, so only the owner learns the channels' reach.
  const reach = (): ChannelReach => {
    if (props.detail.access !== 'owner') return 'none';
    if (props.detail.form.audience === 'public') return 'public';
    const people = invited.value();
    if (people === null) return 'none';
    return people === undefined ? 'unknown' : people;
  };
  const [exporting, setExporting] = createSignal(false);

  async function exportCsv() {
    if (exporting()) return;
    setExporting(true);
    const exported = await context.responses.exportCsv(
      form().databaseId,
      form().tableId
    );
    setExporting(false);
    if (exported.isErr())
      context.notify.failure(
        `The CSV couldn’t be exported: ${exported.error.message}`
      );
  }

  return (
    <div class="@container/responses flex size-full min-h-0 flex-col bg-canvas-base">
      <div class="flex flex-col gap-3 border-b border-edge-divider px-4 pt-4 pb-3 @2xl/responses:px-6">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-base font-semibold text-ink">
            {table.tableName() ?? 'Responses'}
          </h2>
          <span class="inline-flex items-center gap-1 rounded-full border border-edge-muted bg-surface px-2 py-0.5 text-xs text-ink-muted">
            <ClipboardText class="size-3.5 text-violet" aria-hidden="true" />
            Linked to {form().name}
          </span>
          <div class="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => props.onOpenDatabase(form().databaseId)}
            >
              <ArrowSquareOut class="size-3.5" />
              Open database
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting()}
              aria-busy={exporting()}
              onClick={() => void exportCsv()}
            >
              <DownloadSimple class="size-3.5" />
              Export CSV
            </Button>
          </div>
        </div>
        <Show
          when={!summary.failure()}
          fallback={
            <p class="text-xs text-failure-ink">
              The response counts couldn’t be loaded.
            </p>
          }
        >
          <StatTiles
            loading={!summary.value()}
            tiles={responseTiles(
              summary.value() ?? {
                submitted: 0,
                stopped: 0,
                stoppedBySection: [],
                rows: 0,
              },
              reach(),
              (sectionId) => sectionName(props.detail.layout, sectionId)
            )}
          />
        </Show>
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        {context.ui.renderResponsesGrid({
          databaseId: form().databaseId,
          tableId: form().tableId,
        })}
      </div>
    </div>
  );
}
