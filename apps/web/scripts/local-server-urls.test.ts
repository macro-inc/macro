import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('uses HTTPS/WSS and the browser origin for local services and logout', async () => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('VITE_LOCAL_SERVERS', 'ALL');
  vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', 'same-origin');
  vi.stubEnv('VITE_SYNC_SERVICE_HOST', '');
  vi.stubGlobal(
    'location',
    new URL('https://forge.tail66c63e.ts.net:3000/app')
  );
  const { SERVER_HOSTS, SYNC_SERVICE_HOSTS } = await import(
    '../src/lib/core/constant/servers'
  );
  expect(SERVER_HOSTS['auth-service']).toBe(
    'https://forge.tail66c63e.ts.net:3000/auth'
  );
  expect(SERVER_HOSTS['auth-logout']).toBe(
    'https://forge.tail66c63e.ts.net:3000/app'
  );
  expect(SERVER_HOSTS['connection-gateway']).toBe(
    'wss://forge.tail66c63e.ts.net:3000/connection-gateway'
  );
  expect(SERVER_HOSTS['static-file']).toBe(
    'https://forge.tail66c63e.ts.net:3000/static-file'
  );
  expect(SYNC_SERVICE_HOSTS).toEqual({
    worker: 'https://forge.tail66c63e.ts.net:3000/sync',
    ws: 'wss://forge.tail66c63e.ts.net:3000/sync',
  });
});

it('does not change deployed service or logout URLs', async () => {
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('VITE_LOCAL_SERVERS', 'ALL');
  vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', 'same-origin');
  vi.stubGlobal(
    'location',
    new URL('https://forge.tail66c63e.ts.net:3000/app')
  );
  const { SERVER_HOSTS } = await import('../src/lib/core/constant/servers');
  expect(SERVER_HOSTS['auth-service']).toBe('https://gateway.macro.com/auth');
  expect(SERVER_HOSTS['auth-logout']).toMatch(
    /^https:\/\/auth\.macro\.com\/oauth2\/logout\?/
  );
});
