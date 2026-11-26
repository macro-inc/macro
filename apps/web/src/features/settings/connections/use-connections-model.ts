import { useConnectors } from '@queries/connectors';
import { createMemo } from 'solid-js';
import { toConnectionsModel } from './model';

/** Agent tool connections, as the server lists them for settings. */
export function useConnectionsModel() {
  const connectors = useConnectors();
  // A failed first read is an answer too: the page shows its retry.
  const ready = () => connectors.ready() || connectors.error();
  const error = () => connectors.error() && !connectors.ready();
  const model = createMemo(() => toConnectionsModel(connectors.list()));
  return { model, ready, error, retry: connectors.retry };
}
