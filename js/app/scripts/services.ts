export type Service = {
  name: string;
  dev: string;
  prod: string;
  local: string;
  output: string;
  orvalKey: string;
};

export const services: Service[] = [
  {
    name: "cloud-storage",
    dev: "https://cloud-storage-dev.macro.com/api-doc/openapi.json",
    prod: "https://cloud-storage.macro.com/api-doc/openapi.json",
    local: "http://localhost:8083/api-doc/openapi.json",
    output: "../packages/service-clients/service-storage/",
    orvalKey: "storageService",
  },
  {
    name: "document-cognition",
    dev: "https://document-cognition-dev.macro.com/api-doc/openapi.json",
    prod: "https://document-cognition-dev.macro.com/api-doc/openapi.json",
    local: "http://localhost:8088/api-doc/openapi.json",
    output: "../packages/service-clients/service-cognition/",
    orvalKey: "cognitionService",
  },
  {
    name: "auth-service",
    dev: "https://auth-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://auth-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8084/api-doc/openapi.json",
    output: "../packages/service-clients/service-auth/",
    orvalKey: "authService",
  },
  {
    name: "comms-service",
    dev: "https://comms-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://comms-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8086/api-doc/openapi.json",
    output: "../packages/service-clients/service-comms/",
    orvalKey: "commsService",
  },
  {
    name: "notification-service",
    dev: "https://notifications-dev.macro.com/api-doc/openapi.json",
    prod: "https://notifications.macro.com/api-doc/openapi.json",
    local: "http://localhost:8086/api-doc/openapi.json",
    output: "../packages/service-clients/service-notification/",
    orvalKey: "notificationService",
  },
  {
    name: "static-files",
    dev: "https://static-file-service-dev.macro.com/api/api-doc/openapi.json",
    prod: "https://static-file-service.macro.com/api/api-doc/openapi.json",
    local: "http://localhost:8089/api/api-doc/openapi.json",
    output: "../packages/service-clients/service-static-files/",
    orvalKey: "staticFileService",
  },
  {
    name: "connection-gateway",
    dev: "https://connection-gateway-dev.macro.com/api-doc/openapi.json",
    prod: "https://connection-gateway-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8085/api-doc/openapi.json",
    output: "../packages/service-clients/service-connection/",
    orvalKey: "connectionGateway",
  },
  {
    name: "contacts-service",
    dev: "https://contacts-dev.macro.com/api-doc/openapi.json",
    prod: "https://contacts.macro.com/api-doc/openapi.json",
    local: "http://localhost:8092/api-doc/openapi.json",
    output: "../packages/service-clients/service-contacts/",
    orvalKey: "contactService",
  },
  {
    name: "unfurl-service",
    dev: "https://unfurl-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://unfurl-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8080/api-doc/openapi.json",
    output: "../packages/service-clients/service-unfurl/",
    orvalKey: "unfurlService",
  },
  {
    name: "email-service",
    dev: "https://email-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://email-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8094/api-doc/openapi.json",
    output: "../packages/service-clients/service-email/",
    orvalKey: "emailService",
  },
  {
    name: "search-service",
    dev: "https://search-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://search-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8091/api-doc/openapi.json",
    output: "../packages/service-clients/service-search/",
    orvalKey: "searchService",
  },
  {
    name: "properties-service",
    dev: "https://properties-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://properties-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8095/api-doc/openapi.json",
    output: "../packages/service-clients/service-properties/",
    orvalKey: "propertiesService",
  },
  {
    name: "organization-service",
    dev: "https://organization-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://organization-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8096/api-doc/openapi.json",
    output: "../packages/service-clients/service-organization/",
    orvalKey: "organization",
  }
];

export const documentCognitionBase: Service = {
  name: "document-cognition",
  dev: "https://document-cognition-dev.macro.com",
  prod: "https://document-cognition.macro.com",
  local: "http://localhost:8088",
  output: "../packages/service-clients/service-cognition/",
  orvalKey: "cognitionService",
};

export function serviceUrl(service: Service): string {
  const isProd = process.env.MODE === "production";
  const isLocal =
    process.env.MODE === "local" || process.env.LOCAL_BACKEND === "true";
  const schemaUrl = isLocal
    ? service.local
    : isProd
      ? service.prod
      : service.dev;
  console.log(`resolved schema: ${schemaUrl}`)
  return schemaUrl;
}
