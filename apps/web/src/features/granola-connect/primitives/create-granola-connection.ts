import { toast } from '@core/component/Toast/Toast';
import {
  appConnectorKey,
  connectConnector,
  useConnectors,
  useRemoveConnectorMutation,
  useUpdateConnectorMutation,
} from '@queries/connectors';
import { createSignal } from 'solid-js';
import {
  GRANOLA_APP_SLUG,
  type GranolaConnectionStatus,
  granolaConnectionStatus,
} from '../core/granola';

const GRANOLA_KEY = appConnectorKey(GRANOLA_APP_SLUG);

/**
 * The user's Granola connection. Connecting is the whole setup: the backend
 * imports meetings as calls through the connection's API on its own.
 * `status` is undefined until the connector list has loaded, so callers
 * never mistake "loading" for "not connected".
 */
export function createGranolaConnection() {
  const connectors = useConnectors();
  const update = useUpdateConnectorMutation();
  const remove = useRemoveConnectorMutation();
  const [connecting, setConnecting] = createSignal(false);

  const status = (): GranolaConnectionStatus | undefined =>
    connectors.ready()
      ? granolaConnectionStatus(connectors.appStatus(GRANOLA_APP_SLUG))
      : undefined;
  /** Meetings sync only through a connection that provides Granola's API. */
  const syncs = () => connectors.app(GRANOLA_APP_SLUG)?.api ?? false;

  const connect = async () => {
    if (connecting()) return;
    setConnecting(true);
    try {
      if (status() === 'disabled') {
        await update.mutateAsync({ key: GRANOLA_KEY, enabled: true });
        return;
      }
      await connectConnector({ key: GRANOLA_KEY });
    } catch {
      toast.failure('Failed to connect Granola');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await remove.mutateAsync({ key: GRANOLA_KEY });
    } catch {
      toast.failure('Failed to disconnect Granola');
    }
  };

  return {
    status,
    syncs,
    connect,
    connecting,
    disconnect,
    disconnecting: () => remove.isPending,
  };
}
