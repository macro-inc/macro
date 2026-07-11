import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: '../../static_assets/schema.graphql',
  documents: ['packages/service-clients/service-storage/graphql/**/*.graphql'],
  generates: {
    'packages/service-clients/service-storage/graphql/generated/graphql.ts': {
      plugins: ['typescript-operations', 'typed-document-node'],
      config: {
        enumsAsTypes: true,
        preResolveTypes: false,
        scalars: {
          JSON: 'unknown',
        },
        useTypeImports: true,
      },
    },
  },
};

export default config;
