import { Show } from 'solid-js';
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
export function ResponsesView(props: { detail: FormDetail }) {
  const context = useFormContext();
  const form = () => props.detail.form;
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
  return (
    <div class="@container/responses flex size-full min-h-0 flex-col bg-canvas-base">
      <div class="flex flex-col gap-3 px-4 pt-4 pb-3 @2xl/responses:px-6">
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
