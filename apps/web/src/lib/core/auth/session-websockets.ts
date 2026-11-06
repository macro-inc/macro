import { useIsAuthenticated, useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { contentHash } from '@core/util/hash';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  connectionGatewaySessionTelemetry,
  ws,
} from '@service-connection/websocket';
import { storageSessionTelemetry, storageWS } from '@service-storage/websocket';
import { createEffect, on, onCleanup } from 'solid-js';

async function finishActivationSpan(span: Span, userId: string) {
  try {
    // Macro IDs can contain email addresses. Keep only an opaque identifier,
    // and suppress the runtime's raw user-ID enrichment for this entire trace.
    span.setAttr(
      'user.id_hash',
      await contentHash(new TextEncoder().encode(userId))
    );
  } catch {
    span.setAttr('user.id_hash_unavailable', true);
  } finally {
    span.end();
  }
}

/** Account sockets stay closed on public pages and belong to one signed-in session. */
export function useSessionWebsockets() {
  const authenticated = useIsAuthenticated();
  const userId = useUserId();
  createEffect(
    on(
      () => (authenticated() === true ? userId() : undefined),
      (id) => {
        if (!id) return;
        const activation = Telemetry.anonymousSpan(
          'auth.session_websockets.activate'
        );
        activation.setAttr('outcome', 'activated');
        const stopGatewayTrace =
          connectionGatewaySessionTelemetry.activate(activation);
        const stopStorageTrace = storageSessionTelemetry.activate(activation);
        fireAndForget(
          finishActivationSpan(activation, id),
          'session-websockets'
        );
        ws.reconnect();
        storageWS.reconnect();
        onCleanup(() => {
          stopGatewayTrace();
          stopStorageTrace();
          ws.close();
          storageWS.close();
          // Never send a previous account's queued presence after another login.
          while (ws.buffer?.read() !== undefined) {}
        });
      }
    )
  );
}
