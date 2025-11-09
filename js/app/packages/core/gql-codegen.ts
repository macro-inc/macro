import type { CodegenConfig } from '@graphql-codegen/cli';

const isProd = process.env.MODE === 'production';
const isLocal =
  process.env.MODE === 'local' || process.env.LOCAL_BACKEND === 'true';
const schemaUrl = isLocal
  ? 'http://localhost:8080/graphql/'
  : isProd
    ? 'https://api.macro.com/graphql/'
    : 'https://api-dev.macro.com/graphql/';
console.log(`Codegen GraphQL Schema URL: ${schemaUrl}`);

const codegenKey = isLocal ? 'test_key' : 'fdsalkfsdalkjfiosadjvld124086';
console.log(`Codegen GraphQL Schema KEY: ${codegenKey}`);

const config: CodegenConfig = {
  overwrite: true,
  schema: {
    [schemaUrl]: {
      headers: {
        'x-allow-introspection': codegenKey,
      },
    },
  },
  generates: {
    'internal/generated/introspectedSchema.ts': {
      plugins: ['urql-introspection'],
      config: {
        module: 'es2015',
      },
    },
  },
};

export default config;
