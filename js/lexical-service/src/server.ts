import './polyfills/prism';
import app from './index';

const PORT = parseInt(process.env.PORT || '8096', 10);

const env = {
  INTERNAL_AUTH_KEY: process.env.INTERNAL_AUTH_KEY || process.env.INTERNAL_API_SECRET_KEY,
  SYNC_SERVICE_AUTH_KEY: process.env.SYNC_SERVICE_AUTH_KEY,
  SYNC_SERVICE_URL: process.env.SYNC_SERVICE_URL,
  SYNC_SERVICE: undefined,
};

const requiredVars = ['INTERNAL_AUTH_KEY', 'SYNC_SERVICE_AUTH_KEY', 'SYNC_SERVICE_URL'] as const;
for (const varName of requiredVars) {
  if (!env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    return app.fetch(req, env);
  },
});

console.log(`Lexical service listening on http://localhost:${server.port}`);
