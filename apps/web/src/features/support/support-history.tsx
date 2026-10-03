import { useSplitLayout } from '@components/app/split-layout/layout';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { supportClient } from '@service-storage/support';
import { useQuery } from '@tanstack/solid-query';
import { createMemo, For, Show } from 'solid-js';
import { statusLabels } from './core/types';
/** Public Support integration for company and contact records. */
export function SupportHistory(props: {
  companyId?: string;
  contactId?: string;
}) {
  const team = useCurrentTeamQuery();
  const teamId = createMemo(() =>
    team.isSuccess ? team.data?.team?.id : undefined
  );
  const layout = useSplitLayout();
  const query = useQuery(() => ({
    queryKey: [
      'support',
      teamId(),
      'crm-history',
      props.companyId,
      props.contactId,
    ],
    queryFn: () =>
      supportClient.tickets({
        company_id: props.companyId,
        contact_id: props.contactId,
      }),
    enabled: !!teamId() && !!(props.companyId || props.contactId),
  }));
  const items = () => (query.isSuccess ? query.data : []);
  const open = (id?: string) =>
    layout.openWithSplit({
      type: 'component',
      id: 'support',
      params: {
        initialTicket: id,
        companyId: props.companyId,
        contactId: props.contactId,
      },
    });
  return (
    <section class="p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-medium">Customer support</h3>
        <button class="text-xs text-accent" onClick={() => open()}>
          Open Support ↗
        </button>
      </div>
      <Show when={query.isError}>
        <p class="text-xs text-failure">Support history could not load.</p>
      </Show>
      <Show
        when={!query.isLoading}
        fallback={<p class="text-xs text-ink-muted">Loading tickets…</p>}
      >
        <For
          each={items()}
          fallback={
            <p class="text-xs text-ink-muted">
              No tickets linked to this record yet.
            </p>
          }
        >
          {(ticket) => (
            <button
              class="flex w-full items-center justify-between py-3 text-left border-b border-edge-muted"
              onClick={() => open(ticket.id)}
            >
              <span class="text-sm">{ticket.subject}</span>
              <span class="text-xs text-ink-muted">
                {statusLabels[ticket.status]}
              </span>
            </button>
          )}
        </For>
      </Show>
      <Show when={items().length === 100}>
        <button class="mt-4 text-xs text-accent" onClick={() => open()}>
          View all tickets in Support ↗
        </button>
      </Show>
    </section>
  );
}
