/**
 * Services attached to the shared gateway ALB listener.
 * Add a member when a service migrates onto the gateway.
 */
export enum GatewayService {
  DOCUMENT_STORAGE_SERVICE = 'DOCUMENT_STORAGE_SERVICE',
  UNFURL_SERVICE = 'UNFURL_SERVICE',
  CONVERT_SERVICE = 'CONVERT_SERVICE',
  NOTIFICATION_SERVICE = 'NOTIFICATION_SERVICE',
  CONTACTS_SERVICE = 'CONTACTS_SERVICE',
  SEARCH_PROCESSING_SERVICE = 'SEARCH_PROCESSING_SERVICE',
  IMAGE_PROXY_SERVICE = 'IMAGE_PROXY_SERVICE',
  AGENT_HARNESS_SERVICE = 'AGENT_HARNESS_SERVICE',
  AGENT_SCHEDULE_SERVICE = 'AGENT_SCHEDULE_SERVICE',
  CONNECTION_GATEWAY = 'CONNECTION_GATEWAY',
  AUTHENTICATION_SERVICE = 'AUTHENTICATION_SERVICE',
  EMAIL_SERVICE = 'EMAIL_SERVICE',
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
  [GatewayService.UNFURL_SERVICE]: 20,
  [GatewayService.NOTIFICATION_SERVICE]: 30,
  [GatewayService.CONTACTS_SERVICE]: 40,
  [GatewayService.SEARCH_PROCESSING_SERVICE]: 50,
  [GatewayService.IMAGE_PROXY_SERVICE]: 60,
  [GatewayService.AGENT_HARNESS_SERVICE]: 70,
  [GatewayService.AGENT_SCHEDULE_SERVICE]: 80,
  [GatewayService.CONNECTION_GATEWAY]: 90,
  [GatewayService.AUTHENTICATION_SERVICE]: 100,
  [GatewayService.EMAIL_SERVICE]: 110,
  [GatewayService.CONVERT_SERVICE]: 3000,
};

const assigned = Object.values(GATEWAY_PRIORITIES);
if (new Set(assigned).size !== assigned.length) {
  throw new Error('GATEWAY_PRIORITIES values must be unique');
}
