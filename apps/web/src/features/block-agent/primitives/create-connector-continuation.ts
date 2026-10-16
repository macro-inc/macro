import type { PipedreamConnectOutcome } from '@queries/pipedream-connectors';
import { createSignal, onCleanup } from 'solid-js';

/** Resume only the agent turn that initiated a successful connection. */
export function createConnectorContinuation(deps: {
  disabled: () => boolean;
  revision: () => string;
  connect: (app: {
    appSlug: string;
    serverName: string;
  }) => Promise<PipedreamConnectOutcome>;
  resume: (name: string) => Promise<void>;
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
      const outcome = await deps.connect({
        appSlug: app.appSlug,
        serverName: app.name,
      });
      if (disposed) return;
      if (outcome === 'unsupported') {
        deps.notify('Connectors are not available on this deployment');
        return;
      }
      if (outcome !== 'connected') return;
      if (deps.disabled() || revision !== deps.revision()) {
        deps.notify(
          `${app.name} connected. Send a message when you are ready to continue.`
        );
        return;
      }
      await deps.resume(app.name);
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
