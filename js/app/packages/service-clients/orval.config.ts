import { defineConfig } from 'orval';

export default defineConfig({
  authService: {
    output: {
      client: 'fetch',
      target: './service-auth/generated/client.ts',
      schemas: './service-auth/generated/schemas',
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
    },
    input: {
      target: './service-email/openapi.json',
    },
  },

  notificationService: {
    output: {
      client: 'zod',
      mode: 'split',
      target: './service-notification/generated/zod.ts',
      schemas: './service-notification/generated/schemas',
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
    },
    input: {
      target: './service-properties/openapi.json',
    },
  },
  scheduledActionService: {
    output: {
      client: 'fetch',
      target: './service-scheduled-action/generated/client.ts',
      schemas: './service-scheduled-action/generated/schemas',
      override: {
        useDates: false,
      },
    },
    input: {
      target: './service-scheduled-action/openapi.json',
    },
  },
  searchService: {
    output: {
      client: 'fetch',
      target: './service-search/generated/client.ts',
      schemas: './service-search/generated/models',
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
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
      override: {
        useDates: false,
      },
    },
    input: {
      target: './service-unfurl/openapi.json',
    },
  },
});
