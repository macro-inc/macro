import type { PipedreamConnectOutcome } from '@queries/pipedream-connectors';
import { createSignal, onCleanup } from 'solid-js';

/**
 * Resume only the agent turn that initiated a successful connection.
 * `connect` resolves whether the app ended up connected, resumed or not.
 */
export function createConnectorContinuation(deps: {
  disabled: () => boolean;
  revision: () => string;
  connect: (app: {
    appSlug: string;
    serverName: string;
  }) => Promise<PipedreamConnectOutcome>;
  resume: (app: { appSlug: string; name: string }) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [pending, setPending] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const disabled = () => pending() || deps.disabled();

  async function connect(app: {
    appSlug: string;
    name: string;
  }): Promise<boolean> {
    if (disposed || disabled()) return false;
    const revision = deps.revision();
    setPending(true);
    let connected = false;
    try {
      const outcome = await deps.connect({
        appSlug: app.appSlug,
        serverName: app.name,
      });
      if (disposed) return false;
      if (outcome === 'unsupported') {
        deps.notify('Connectors are not available on this deployment');
        return false;
      }
      if (outcome !== 'connected') return false;
      connected = true;
      if (deps.disabled() || revision !== deps.revision()) {
        deps.notify(
          `${app.name} connected. Send a message when you are ready to continue.`
        );
        return true;
      }
      await deps.resume(app);
      return true;
    } catch {
      if (disposed) return connected;
      if (connected) {
        deps.notify(`${app.name} connected. Send a message to continue.`);
      } else {
        deps.notify(
          `Could not connect ${app.name} and continue. Please try again.`
        );
      }
      return connected;
    } finally {
      setPending(false);
    }
  }
  return { connect, disabled };
}
