/**
 * Services attached to the shared gateway ALB listener.
 * Add a member when a service migrates onto the gateway.
 */
export enum GatewayService {
  DOCUMENT_STORAGE_SERVICE = 'DOCUMENT_STORAGE_SERVICE',
}

/**
 * Listener-rule priority for every gateway tenant.
 */
type GatewayPriorityMap = { [K in GatewayService]: number };

/**
 * Source of truth for shared-gateway ALB listener-rule priorities.
 * Values on this listener must be unique. A missing key is a compile error.
 */
export const GATEWAY_PRIORITIES: GatewayPriorityMap = {
  [GatewayService.DOCUMENT_STORAGE_SERVICE]: 10,
};

const assigned = Object.values(GATEWAY_PRIORITIES);
if (new Set(assigned).size !== assigned.length) {
  throw new Error('GATEWAY_PRIORITIES values must be unique');
}
