import type { ConnectOutcome } from '@queries/connectors';
import { createSignal, onCleanup } from 'solid-js';

/**
 * Resume only the agent turn that initiated a successful connection.
 *
 * Connecting never waits for the agent: a reply often asks for an app and
 * keeps working, and a chip that ignores clicks until the turn ends reads as
 * broken. Only the resume does: a connection that lands while the agent is
 * busy, or after the transcript moved on, asks the user to continue instead.
 */
export function createConnectorContinuation(deps: {
  /** Whether this user may connect here at all. */
  disabled: () => boolean;
  /** Whether the agent is working, so its turn can't be continued in place. */
  busy: () => boolean;
  revision: () => string;
  connect: (app: { appSlug: string }) => Promise<ConnectOutcome>;
  resume: (app: { appSlug: string; name: string }) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [pending, setPending] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const disabled = () => pending() || deps.disabled();

  async function connect(app: { appSlug: string; name: string }) {
    if (disposed || disabled()) return;
    const revision = deps.revision();
    setPending(true);
    try {
      const outcome = await deps.connect({ appSlug: app.appSlug });
      if (disposed) return;
      if (outcome !== 'connected') return;
      if (deps.disabled() || deps.busy() || revision !== deps.revision()) {
        deps.notify(
          `${app.name} connected. Send a message when you are ready to continue.`
        );
        return;
      }
      await deps.resume(app);
    } catch {
      if (!disposed)
        deps.notify(
          `Could not connect ${app.name} and continue. Please try again.`
        );
    } finally {
      setPending(false);
    }
  }
  return { connect, disabled };
}
