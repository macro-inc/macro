import { toast } from '@core/component/Toast/Toast';
import { queryReadyGate } from '@queries/gate';
import {
  connectPipedreamApp,
  useDeletePipedreamConnectionMutation,
  usePipedreamConnectionsQuery,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createSignal } from 'solid-js';
import {
  GRANOLA_APP_SLUG,
  GRANOLA_DISPLAY_NAME,
  type GranolaConnectionStatus,
  granolaConnectionStatus,
} from '../core/granola';

/**
 * The user's Granola connection through Pipedream. Connecting is the whole
 * setup: the backend starts importing meetings as calls on its own.
 * `status` is undefined until the connection list has loaded, so callers
 * never mistake "loading" for "not connected".
 */
export function createGranolaConnection() {
  const connections = usePipedreamConnectionsQuery({ neverSuspend: true });
  const update = useUpdatePipedreamConnectionMutation();
  const remove = useDeletePipedreamConnectionMutation();
  const [connecting, setConnecting] = createSignal(false);

  const status = (): GranolaConnectionStatus | undefined =>
    !connections.isPlaceholderData && queryReadyGate(connections)
      ? granolaConnectionStatus(connections.data ?? [])
      : undefined;

  const connect = async () => {
    if (connecting()) return;
    setConnecting(true);
    try {
      if (status() === 'disabled') {
        await update.mutateAsync({
          app_slug: GRANOLA_APP_SLUG,
          enabled: true,
        });
        return;
      }
      const outcome = await connectPipedreamApp({
        appSlug: GRANOLA_APP_SLUG,
        serverName: GRANOLA_DISPLAY_NAME,
      });
      if (outcome === 'unsupported')
        toast.failure('Connectors are not available on this deployment');
    } catch {
      toast.failure('Failed to connect Granola');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await remove.mutateAsync({ app_slug: GRANOLA_APP_SLUG });
    } catch {
      toast.failure('Failed to disconnect Granola');
    }
  };

  return {
    status,
    connect,
    connecting,
    disconnect,
    disconnecting: () => remove.isPending,
  };
}
