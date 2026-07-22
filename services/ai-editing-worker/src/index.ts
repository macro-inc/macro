import './globals';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import endpoints from './endpoints';
import type { Bindings } from './env';

// Mirrors crates/macro_cors's ALLOWED_ORIGINS/is_allowed_origin.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'https://dashboarddev.macro.com',
  'https://dashboard.macro.com',
  'http://host.local:3000',
  'https://dev.macro.com',
  'https://www.macro.com',
  'https://macro.com',
  'http://tauri.localhost',
  'tauri://localhost',
]);

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    if (
      protocol === 'https:' &&
      (hostname === 'preview.macro.com' ||
        hostname.endsWith('.preview.macro.com'))
    ) {
      return true;
    }
  } catch {
    // Not a valid URL; fall through to the other checks.
  }

  const localhostPort = origin.match(/^http:\/\/localhost:(\d+)$/)?.[1];
  if (localhostPort) {
    const port = Number(localhostPort);
    return (port >= 3000 && port <= 3999) || (port >= 20000 && port <= 60000);
  }
  return false;
}

const app = new Hono<{ Bindings: Bindings }>();

// The web app calls /edit directly from the browser; auth is the document
// permission token in the body, so we scope CORS to known Macro origins.
app.use(
  '*',
  cors({
    origin: (origin) => (isOriginAllowed(origin) ? origin : null),
  })
);
app.route('/', endpoints);

export default app;
