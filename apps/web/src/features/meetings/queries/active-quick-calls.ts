import { getMeetingUrl } from '@channel/Call/call-link';
import { thrownResultErrorHasCode } from '@core/util/result';
import { useActiveMeetingsQuery } from '@queries/call/meetings';
import type { Accessor } from 'solid-js';
import type { CallSidebarSources } from '../context/call-sidebar';

export function useActiveQuickCallsSource(
  userId: Accessor<string | undefined>
): CallSidebarSources['active'] {
  const query = useActiveMeetingsQuery(userId);
  const accessDenied = () =>
    thrownResultErrorHasCode(query.error, 'UNAUTHORIZED') ||
    thrownResultErrorHasCode(query.error, 'FORBIDDEN');
  return {
    calls: () =>
      userId() && !query.isPending && !accessDenied()
        ? (query.data ?? []).map((meeting) => ({
            id: meeting.id,
            createdBy: meeting.createdBy,
            title: meeting.title,
            url: getMeetingUrl(meeting.shareToken),
          }))
        : [],
    error: () =>
      userId() && query.isError ? 'Could not load active calls.' : undefined,
    refresh: () => {
      void query.refetch();
    },
  };
}
