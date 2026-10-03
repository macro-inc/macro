import { useCurrentTeamQuery } from '@queries/team/teams';
import { supportClient } from '@service-storage/support';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { createMemo, createSignal } from 'solid-js';
import type { Workspace } from '../context/contracts';
import type { TicketFilter } from '../core/types';
export function createWorkspace(initial: {
  ticket?: string;
  companyId?: string;
  contactId?: string;
}): Workspace {
  const team = useCurrentTeamQuery();
  const teamId = createMemo(() =>
    team.isSuccess ? team.data?.team?.id : undefined
  );
  const [selected, select] = createSignal(initial.ticket);
  const client = useQueryClient();
  const scope = () => ({
    company_id: initial.companyId,
    contact_id: initial.contactId,
  });
  const tickets = useInfiniteQuery(() => ({
    queryKey: ['support', teamId(), 'tickets', scope()],
    initialPageParam: undefined as TicketFilter | undefined,
    queryFn: ({ pageParam }) =>
      supportClient.tickets({ ...scope(), ...pageParam }),
    enabled: !!teamId(),
    refetchInterval: 10000,
    getNextPageParam: (last) =>
      last.length === 100
        ? {
            before: last[last.length - 1].updated_at,
            before_id: last[last.length - 1].id,
          }
        : undefined,
  }));
  const detail = useQuery(() => ({
    queryKey: ['support', teamId(), 'detail', selected()],
    queryFn: () => supportClient.detail(selected()!),
    enabled: !!teamId() && !!selected(),
    refetchInterval: 5000,
  }));
  const settings = useQuery(() => ({
    queryKey: ['support', teamId(), 'settings'],
    queryFn: supportClient.settings,
    enabled: !!teamId(),
  }));
  const inboxes = useQuery(() => ({
    queryKey: ['support', teamId(), 'inboxes'],
    queryFn: supportClient.inboxes,
    enabled: !!teamId(),
  }));
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['support', teamId()] });
  return {
    tickets: () => (tickets.isSuccess ? tickets.data.pages.flat() : []),
    detail: () => (detail.isSuccess ? detail.data : undefined),
    settings: () => (settings.isSuccess ? settings.data : undefined),
    inboxes: () => (inboxes.isSuccess ? inboxes.data : []),
    selected,
    select,
    loading: () =>
      team.isPending || tickets.isLoading || (!!selected() && detail.isLoading),
    error: () =>
      team.isError
        ? 'Unable to load your team.'
        : team.isSuccess && !teamId()
          ? 'Join a team to use Support.'
          : [tickets, detail, settings, inboxes].some((q) => q.isError)
            ? 'Support could not load. Please try again.'
            : undefined,
    loadMore: async () => {
      await tickets.fetchNextPage();
    },
    hasMore: () => !!tickets.hasNextPage,
    create: async (input) => {
      const ticket = await supportClient.create(input);
      select(ticket.id);
      await refresh();
      return ticket;
    },
    patch: async (id, input) => {
      await supportClient.patch(id, input);
      await refresh();
    },
    reply: async (id, input) => {
      await supportClient.reply(id, input);
      await refresh();
    },
    configure: async (input) => {
      await supportClient.configure(input);
      await refresh();
    },
    linkTask: async (id, input) => {
      const task = await supportClient.linkTask(id, input);
      await refresh();
      return task;
    },
    unlinkTask: async (id, task) => {
      await supportClient.unlinkTask(id, task);
      await refresh();
    },
  };
}
