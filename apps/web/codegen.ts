import type { CodegenConfig } from '@graphql-codegen/cli';
import type { CacheOnlyProjectionConfig } from './scripts/graphql-cache-only-projection-codegen';

const config: CodegenConfig = {
  schema: [
    '../../static_assets/schema.graphql',
    'graphql-client-schema.graphql',
  ],
  documents: ['src/lib/service-clients/service-storage/graphql/**/*.graphql'],
  generates: {
    'src/lib/service-clients/service-storage/graphql/generated/graphql.ts': {
      plugins: [
        'typescript-operations',
        './scripts/shared-typed-document-node-codegen.ts',
        {
          './scripts/graphql-cache-only-projection-codegen.ts': {
            // Only hydration consumes a result with cache-only fields removed.
            cacheOnlyResultOperations: ['SoupBackfill'],
          } satisfies CacheOnlyProjectionConfig,
        },
      ],
      config: {
        enumsAsTypes: true,
        preResolveTypes: false,
        scalars: {
          JSON: 'unknown',
          SoupCacheProjection: 'string',
        },
        useTypeImports: true,
      },
    },
  },
};

export default config;
