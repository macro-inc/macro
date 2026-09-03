import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { ENABLE_EMAIL } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useGithubLinkStatusQuery } from '@queries/auth';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { useEmailLinksQuery } from '@queries/email/link';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createMemo } from 'solid-js';
import { type ConnectionsModel, toConnectionsModel } from './model';

const EMPTY_MODEL: ConnectionsModel = {
  capabilities: [],
  leftovers: [],
  providers: [],
};

/** Read dest connection queries and present them as the Connections model. */
export function useConnectionsModel() {
  const userId = useUserId();
  const calendarEnabled = useCalendarUiFlag();
  const emailLinks = useEmailLinksQuery();
  const github = useGithubLinkStatusQuery();
  const pipedream = usePipedreamConnectionsQuery();
  const nativeMcp = useMcpServersQuery();
  const cursor = useCursorApiKeyStatusQuery();

  const ready = () =>
    (!ENABLE_EMAIL || emailLinks.isFetched) &&
    github.isFetched &&
    pipedream.isFetched &&
    nativeMcp.isFetched &&
    cursor.isFetched;

  const error = () =>
    ready() &&
    ((ENABLE_EMAIL && emailLinks.isError) ||
      github.isError ||
      pipedream.isError ||
      nativeMcp.isError ||
      cursor.isError);

  const retry = () => {
    if (ENABLE_EMAIL) void emailLinks.refetch();
    void github.refetch();
    void pipedream.refetch();
    void nativeMcp.refetch();
    void cursor.refetch();
  };

  const model = createMemo(() => {
    if (!ready() || error()) return EMPTY_MODEL;
    return toConnectionsModel({
      userId: userId(),
      emailEnabled: ENABLE_EMAIL,
      calendarEnabled: calendarEnabled(),
      emailLinks:
        ENABLE_EMAIL && emailLinks.isSuccess
          ? (emailLinks.data?.links ?? [])
          : [],
      github: github.isSuccess ? github.data : undefined,
      pipedream: pipedream.isSuccess ? (pipedream.data ?? []) : [],
      nativeMcp: nativeMcp.isSuccess ? (nativeMcp.data ?? []) : [],
      cursorRegistered: cursor.isSuccess
        ? (cursor.data?.registered ?? false)
        : false,
    });
  });

  return { model, ready, error, retry };
}
