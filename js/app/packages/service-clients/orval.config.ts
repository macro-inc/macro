import { defineConfig } from 'orval';

export default defineConfig({
  authService: {
    output: {
      client: 'fetch',
      target: './service-auth/generated/client.ts',
      schemas: './service-auth/generated/schemas',
    },
    input: {
      target: './service-auth/openapi.json',
    },
  },
  cognitionService: {
    output: {
      client: 'fetch',
      target: './service-cognition/generated/client.ts',
      schemas: './service-cognition/generated/schemas',
    },
    input: {
      target: './service-cognition/openapi.json',
    },
  },
  commsService: {
    output: {
      client: 'fetch',
      target: './service-comms/generated/client.ts',
      schemas: './service-comms/generated/models',
    },
    input: {
      target: './service-comms/openapi.json',
    },
  },
  connectionGateway: {
    output: {
      client: 'fetch',
      target: './service-connection/generated/client.ts',
      schemas: './service-connection/generated/schemas',
    },
    input: {
      target: './service-connection/openapi.json',
    },
  },
  contactService: {
    output: {
      client: 'fetch',
      target: './service-contacts/generated/client.ts',
      schemas: './service-contacts/generated/schemas',
    },
    input: {
      target: './service-contacts/openapi.json',
    },
  },
  emailService: {
    output: {
      client: 'fetch',
      target: './service-email/generated/client.ts',
      schemas: './service-email/generated/schemas',
    },
    input: {
      target: './service-email/openapi.json',
    },
  },
  insightsService: {
    output: {
      client: 'fetch',
      target: './service-insight/generated/client.ts',
      schemas: './service-insight/generated/schemas',
    },
    input: {
      target: './service-insight/openapi.json',
    },
  },
  notificationService: {
    output: {
      client: 'fetch',
      target: './service-notification/generated/client.ts',
      schemas: './service-notification/generated/schemas',
    },
    input: {
      target: './service-notification/openapi.json',
    },
  },
  organization: {
    output: {
      client: 'zod',
      mode: 'split',
      target: './service-organization/generated/zod.ts',
      schemas: './service-organization/generated/schemas',
      biome: true,
    },
    input: {
      target: './service-organization/openapi.json',
    },
  },
  propertiesService: {
    output: {
      client: 'zod',
      mode: 'split',
      target: './service-properties/generated/zod.ts',
      schemas: './service-properties/generated/schemas',
      indexFiles: false,
      biome: true,
    },
    input: {
      target: './service-properties/openapi.json',
    },
  },
  searchService: {
    output: {
      client: 'fetch',
      target: './service-search/generated/client.ts',
      schemas: './service-search/generated/models',
    },
    input: {
      target: './service-search/openapi.json',
    },
  },
  staticFileService: {
    output: {
      client: 'fetch',
      target: './service-static-files/generated/client.ts',
      schemas: './service-static-files/generated/schemas',
    },
    input: {
      target: './service-static-files/openapi.json',
    },
  },
  storageService: {
    output: {
      client: 'zod',
      mode: 'split',
      target: './service-storage/generated/zod.ts',
      schemas: './service-storage/generated/schemas',
      biome: true,
    },
    input: {
      target: './service-storage/openapi.json',
    },
  },
  unfurlService: {
    output: {
      client: 'fetch',
      target: './service-unfurl/generated/client.ts',
      schemas: './service-unfurl/generated/schemas',
    },
    input: {
      target: './service-unfurl/openapi.json',
    },
  },
});
