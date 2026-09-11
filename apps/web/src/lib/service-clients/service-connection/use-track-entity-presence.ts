import { isTabFocused } from '@core/signal/tabFocus';
import type { EntityType } from '@service-connection/generated/schemas/entityType';
import { createEffect, on, onCleanup } from 'solid-js';
import { connectionGatewayClient } from './client';

/** 20 seconds — same interval BlockContainer uses for document/chat presence. */
const PING_INTERVAL = 20_000;

/**
 * Publish connection-gateway presence for an entity: `open` when the id is
 * known, `ping` while the tab is focused, `close` on id change or unmount.
 *
 * Channels and documents already do this. Agent sessions cannot use
 * `BlockContainer` (the block id can be a create-time placeholder), so they
 * call this with the real session id once it exists.
 */
export function useEntityPresenceTracking(
  entityType: EntityType,
  entityId: () => string | undefined
): void {
  createEffect(
    on(entityId, (id) => {
      if (!id) return;

      const track = (action: 'open' | 'close' | 'ping') => {
        connectionGatewayClient.trackEntity({
          entity_type: entityType,
          entity_id: id,
          action,
        });
      };

      track('open');
      const pingInterval = setInterval(() => {
        if (isTabFocused()) {
          track('ping');
        }
      }, PING_INTERVAL);

      onCleanup(() => {
        track('close');
        clearInterval(pingInterval);
      });
    })
  );
}
