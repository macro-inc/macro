export type Service = {
  name: string;
  dev: string;
  prod: string;
  local: string;
  output: string;
};

export const services: Service[] = [
  {
    name: "cloud-storage",
    dev: "https://cloud-storage-dev.macro.com/api-doc/openapi.json",
    prod: "https://cloud-storage.macro.com/api-doc/openapi.json",
    local: "http://localhost:8083/api-doc/openapi.json",
    output: "../packages/service-storage/",
  },
  {
    name: "document-cognition",
    dev: "https://document-cognition-dev.macro.com/api-doc/openapi.json",
    prod: "https://document-cognition-dev.macro.com/api-doc/openapi.json",
    local: "http://localhost:8088/api-doc/openapi.json",
    output: "../packages/service-cognition/",
  },
  {
    name: "auth-service",
    dev: "https://auth-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://auth-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8084/api-doc/openapi.json",
    output: "../packages/service-auth/",
  },
  {
    name: "comms-service",
    dev: "https://comms-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://comms-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8086/api-doc/openapi.json",
    output: "../packages/service-comms/",
  },
  {
    name: "notification-service",
    dev: "https://notifications-dev.macro.com/api-doc/openapi.json",
    prod: "https://notifications.macro.com/api-doc/openapi.json",
    local: "http://localhost:8086/api-doc/openapi.json",
    output: "../packages/service-notification/",
  },
  {
    name: "static-files",
    dev: "https://static-file-service-dev.macro.com/api/api-doc/openapi.json",
    prod: "https://static-file-service.macro.com/api/api-doc/openapi.json",
    local: "http://localhost:8089/api/api-doc/openapi.json",
    output: "../packages/service-static-files/",
  },
  {
    name: "connection-gateway",
    dev: "https://connection-gateway-dev.macro.com/api-doc/openapi.json",
    prod: "https://connection-gateway-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8085/api-doc/openapi.json",
    output: "../packages/service-connection/",
  },
  {
    name: "contacts-service",
    dev: "https://contacts-dev.macro.com/api-doc/openapi.json",
    prod: "https://contacts.macro.com/api-doc/openapi.json",
    local: "http://localhost:8092/api-doc/openapi.json",
    output: "../packages/service-contacts/",
  },
  {
    name: "unfurl-service",
    dev: "https://unfurl-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://unfurl-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8080/api-doc/openapi.json",
    output: "../packages/service-unfurl/",
  },
  {
    name: "email-service",
    dev: "https://email-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://email-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8094/api-doc/openapi.json",
    output: "../packages/service-email/",
  },
  {
    name: "insight-service",
    dev: "https://insight-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://insight-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8080/api-doc/openapi.json",
    output: "../packages/service-insight/",
  },
  {
    name: "search-service",
    dev: "https://search-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://search-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8091/api-doc/openapi.json",
    output: "../packages/service-search/",
  },
  {
    name: "properties-service",
    dev: "https://properties-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://properties-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8095/api-doc/openapi.json",
    output: "../packages/service-properties/",
  },
  {
    name: "organization-service",
    dev: "https://organization-service-dev.macro.com/api-doc/openapi.json",
    prod: "https://organization-service.macro.com/api-doc/openapi.json",
    local: "http://localhost:8096/api-doc/openapi.json",
    output: "../packages/service-organization/",
  }
];

export const documentCognitionBase: Service = {
  name: "document-cognition",
  dev: "https://document-cognition-dev.macro.com",
  prod: "https://document-cognition.macro.com",
  local: "http://localhost:8088",
  output: "../packages/service-cognition/",
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
