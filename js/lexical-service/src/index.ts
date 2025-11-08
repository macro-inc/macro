// biome-ignore assist/source/organizeImports: <This has to be import manually first>
import './polyfills/prism';

import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { PlaintextEndpoint } from './endpoints/plaintext';
import { CognitionTextEndpoint } from './endpoints/cognition-text';
import { SearchTextEndpoint } from './endpoints/search-text';
import { MarkdownEndpoint } from './endpoints/markdown';

type Bindings = {
  INTERNAL_AUTH_KEY: string;
  SYNC_SERVICE_AUTH_KEY: string;
  SYNC_SERVICE_URL: string;
  SYNC_SERVICE: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Apply internal auth middleware only to API endpoints
app.use('/plaintext/*', async (c, next) => {
  const authKey = c.req.header('x-internal-auth-key');
  if (!authKey || authKey !== c.env.INTERNAL_AUTH_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

app.use('/cognition/*', async (c, next) => {
  const authKey = c.req.header('x-internal-auth-key');
  if (!authKey || authKey !== c.env.INTERNAL_AUTH_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

app.use('/search/*', async (c, next) => {
  const authKey = c.req.header('x-internal-auth-key');
  if (!authKey || authKey !== c.env.INTERNAL_AUTH_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

app.use('/markdown/*', async (c, next) => {
  const authKey = c.req.header('x-internal-auth-key');
  if (!authKey || authKey !== c.env.INTERNAL_AUTH_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

app.use('/internal/health', async (c, next) => {
  const authKey = c.req.header('x-internal-auth-key');
  if (!authKey || authKey !== c.env.INTERNAL_AUTH_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

const openapi = fromHono(app, {
  docs_url: '/',
  schema: {
    info: {
      title: 'Lexical Service API',
      version: '1.0.0',
      description: 'API for converting Lexical documents to various formats',
    },
  },
});

openapi.get('/health', (c) => c.json({ message: 'Healthy' }));
openapi.get('/plaintext/:docId', PlaintextEndpoint);
openapi.get('/cognition/:docId', CognitionTextEndpoint);
openapi.get('/search/:docId', SearchTextEndpoint);
openapi.get('/markdown/:docId', MarkdownEndpoint);
openapi.get('/internal/health', (c) => c.json({ status: 'healthy' }));

export default app;
