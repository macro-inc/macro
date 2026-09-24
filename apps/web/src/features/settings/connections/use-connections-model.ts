import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createMemo } from 'solid-js';
import { toConnectionsModel } from './model';

/** Present agent tool connections independently of personal accounts and harnesses. */
export function useConnectionsModel() {
  const pipedream = usePipedreamConnectionsQuery();
  const nativeMcp = useMcpServersQuery();
  const ready = () => pipedream.isFetched && nativeMcp.isFetched;
  const error = () => ready() && pipedream.isError && nativeMcp.isError;
  const partialError = () =>
    ready() && (pipedream.isError || nativeMcp.isError);
  const retry = () => {
    void pipedream.refetch();
    void nativeMcp.refetch();
  };
  const model = createMemo(() =>
    toConnectionsModel({
      pipedream: pipedream.isSuccess ? (pipedream.data ?? []) : [],
      nativeMcp: nativeMcp.isSuccess ? (nativeMcp.data ?? []) : [],
    })
  );
  return { model, ready, error, partialError, retry };
}
