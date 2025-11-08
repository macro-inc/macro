import swaggerJsdoc, { type Options } from 'swagger-jsdoc';

const localPath = './';

function createSwaggerPaths() {
  const paths: string[] = [];
  for (const path of [localPath]) {
    paths.push(`${path}src/route/*.ts`);
    paths.push(`${path}src/route/**/index.ts`);
    paths.push(`${path}src/types/*.ts`);
    paths.push(`${path}src/types/**/*.ts`);
  }
  return paths;
}

function getHost() {
  switch (process.env.ENVIRONMENT) {
    case 'prod':
      return 'https://document-processing.macro.com';
    case 'dev':
      return 'https://document-processing-dev.macro.com';
    default:
      return 'http://0.0.0.0:8080';
  }
}

const options: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Document Processing Producer Service',
      version: '1.0.0',
    },
    host: getHost(),
  },
  apis: createSwaggerPaths(),
};

export const openapiSpecification = swaggerJsdoc(options);
