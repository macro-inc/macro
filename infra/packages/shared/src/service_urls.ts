import { stack } from '.';

/**
 * Service url for all macro services
 */
export enum ServiceUrl {
  SYNC_SERVICE_URL = 'SYNC_SERVICE_URL',
  COMMS_SERVICE_URL = 'COMMS_SERVICE_URL',
  EMAIL_SERVICE_URL = 'EMAIL_SERVICE_URL',
  STATIC_FILE_SERVICE_URL = 'STATIC_FILE_SERVICE_URL',
  NOTIFICATION_SERVICE_URL = 'NOTIFICATION_SERVICE_URL',
  AUTHENTICATION_SERVICE_URL = 'AUTHENTICATION_SERVICE_URL',
  DOCUMENT_STORAGE_SERVICE_URL = 'DOCUMENT_STORAGE_SERVICE_URL',
  CONNECTION_GATEWAY_URL = 'CONNECTION_GATEWAY_URL',
  DOCUMENT_COGNITION_SERVICE_URL = 'DOCUMENT_COGNITION_SERVICE_URL',
  LEXICAL_SERVICE_URL = 'LEXICAL_SERVICE_URL',
}

/**
 * Map of service URLs
 */
type ServiceUrlMap = {
  [K in ServiceUrl]: string;
};

/**
 * Dev Service URLs
 */
const DEV_SERVICE_URLS: ServiceUrlMap = {
  [ServiceUrl.SYNC_SERVICE_URL]:
    'https://sync-service-dev3.macroverse.workers.dev',
  [ServiceUrl.COMMS_SERVICE_URL]: 'https://comms-service-dev.macro.com',
  [ServiceUrl.EMAIL_SERVICE_URL]: 'https://email-service-dev.macro.com',
  [ServiceUrl.STATIC_FILE_SERVICE_URL]:
    'https://static-file-service-dev.macro.com',
  [ServiceUrl.NOTIFICATION_SERVICE_URL]: 'https://notifications-dev.macro.com',
  [ServiceUrl.AUTHENTICATION_SERVICE_URL]: 'https://auth-service-dev.macro.com',
  [ServiceUrl.DOCUMENT_STORAGE_SERVICE_URL]:
    'https://cloud-storage-dev.macro.com',
  [ServiceUrl.CONNECTION_GATEWAY_URL]:
    'https://connection-gateway-dev.macro.com',
  [ServiceUrl.DOCUMENT_COGNITION_SERVICE_URL]:
    'https://document-cognition-dev.macro.com',
  [ServiceUrl.LEXICAL_SERVICE_URL]:
    'https://lexical-service-dev.macroverse.workers.dev',
};

/**
 * Prod Service URLs
 */
const PROD_SERVICE_URLS: ServiceUrlMap = {
  [ServiceUrl.SYNC_SERVICE_URL]:
    'https://sync-service-prod2.macroverse.workers.dev',
  [ServiceUrl.COMMS_SERVICE_URL]: 'https://comms-service.macro.com',
  [ServiceUrl.EMAIL_SERVICE_URL]: 'https://email-service.macro.com',
  [ServiceUrl.STATIC_FILE_SERVICE_URL]: 'https://static-file-service.macro.com',
  [ServiceUrl.NOTIFICATION_SERVICE_URL]: 'https://notifications.macro.com',
  [ServiceUrl.AUTHENTICATION_SERVICE_URL]: 'https://auth-service.macro.com',
  [ServiceUrl.DOCUMENT_STORAGE_SERVICE_URL]: 'https://cloud-storage.macro.com',
  [ServiceUrl.CONNECTION_GATEWAY_URL]: 'https://connection-gateway.macro.com',
  [ServiceUrl.DOCUMENT_COGNITION_SERVICE_URL]:
    'https://document-cognition.macro.com',
  [ServiceUrl.LEXICAL_SERVICE_URL]:
    'https://lexical-service.macroverse.workers.dev',
};

/**
 * Singleton for service URLs
 */
let _SERVICE_URL_MAP: ServiceUrlMap | undefined = undefined;

/**
 * Gets the service URL map for the stack
 * @throws Error if there is no matching service for the given stack
 * @returns ServiceUrlMap
 */
function getServiceUrls(): ServiceUrlMap {
  if (stack === 'dev') {
    return DEV_SERVICE_URLS;
  } else if (stack === 'prod') {
    return PROD_SERVICE_URLS;
  }

  throw new Error(`Unknown stack: ${stack}`);
}

/**
 * Gets the service URL for a given service
 * @param service Service to get URL for
 * @returns Service URL
 */
export function getServiceUrl(service: ServiceUrl): string {
  // Initialize the singleton
  if (!_SERVICE_URL_MAP) {
    _SERVICE_URL_MAP = getServiceUrls();
  }

  return _SERVICE_URL_MAP[service];
}

/**
 * Gets the domain name for a given service
 * @param service Service to get URL for
 * @returns Domain name
 */
export function getDomainName(service: ServiceUrl): string {
  // Initialize the singleton
  if (!_SERVICE_URL_MAP) {
    _SERVICE_URL_MAP = getServiceUrls();
  }

  return _SERVICE_URL_MAP[service].replace('https://', '');
}
