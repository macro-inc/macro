import { toast } from '@core/component/Toast/Toast';
import { connectConnector } from '@queries/connectors';
import { type Accessor, createSignal } from 'solid-js';

/**
 * Connecting one app or server, with the busy state and failure toast every
 * surface wants. Success needs no toast of its own on surfaces that re-render
 * the row as connected, so callers opt in via `onConnected`.
 */
export function createConnectAction(options: {
  /** The connector key: `app/{slug}`, or a key the server gave. */
  key: Accessor<string>;
  /** What to call it in messages. */
  name: Accessor<string>;
  onConnected?: () => void;
  /** Where an embedded connect dialog mounts; see `connectConnector`. */
  container?: Accessor<HTMLElement | undefined>;
}) {
  const [busy, setBusy] = createSignal(false);

  const connect = async () => {
    if (busy()) return;
    const name = options.name();
    setBusy(true);
    try {
      const outcome = await connectConnector({
        key: options.key(),
        container: options.container?.(),
      });
      if (outcome === 'connected') options.onConnected?.();
    } catch {
      toast.failure(`Failed to connect ${name}`);
    } finally {
      setBusy(false);
    }
  };

  return { connect, busy };
}
