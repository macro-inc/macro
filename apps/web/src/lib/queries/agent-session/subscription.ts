import { useEntitySubscription } from '@service-connection/client';
import type { Accessor } from 'solid-js';

/**
 * Tell the gateway this viewer watches `sessionId`, so its live frames reach
 * them. The owner hears every frame regardless; anyone else would otherwise
 * see nothing live unless they also had the parent channel open.
 */
export function useAgentSessionSubscription(
  sessionId: Accessor<string | undefined>
) {
  useEntitySubscription(() => {
    const id = sessionId();
    return id ? { entity_type: 'agent_session', entity_id: id } : undefined;
  });
}
