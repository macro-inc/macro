import { afterEach, describe, expect, it, vi } from 'vitest';
import { staticFileSizedUrl } from './servers';

describe('staticFileSizedUrl', () => {
  it.each([
    'data:image/png;base64,aW1hZ2U=',
    'blob:https://macro.com/avatar-id',
  ])('preserves embedded or local image sources: %s', (url) => {
    expect(staticFileSizedUrl(url, 'small')).toBe(url);
  });

  it('requests a thumbnail for uploaded images', () => {
    expect(
      staticFileSizedUrl('https://static.macro.com/file/avatar-id', 'small')
    ).toBe('https://static.macro.com/file/avatar-id?size=320');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('keeps browser image URLs proxied but gives the agent a fetchable hosted URL', async () => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('VITE_DEV_PROXY', 'true');
  vi.stubEnv('VITE_LOCAL_SERVERS', '');
  vi.stubGlobal('location', { origin: 'https://localhost:3003' });
  vi.resetModules();
  const { staticFileIdEndpoint, staticFileReferenceEndpoint } = await import(
    './servers'
  );
  expect(staticFileIdEndpoint('test-image')).toBe(
    'https://localhost:3003/__macro_dev/static/file/test-image'
  );
  expect(staticFileReferenceEndpoint('test-image')).toBe(
    'https://static-file-service-dev.macro.com/file/test-image'
  );
});

it('preserves local-stack image references for the local attachment resolver', async () => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('VITE_DEV_PROXY', 'true');
  vi.stubEnv('VITE_LOCAL_SERVERS', 'ALL');
  vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', 'https://localhost:27709');
  vi.stubGlobal('location', new URL('https://localhost:3003'));
  vi.resetModules();
  const { staticFileReferenceEndpoint } = await import('./servers');
  expect(staticFileReferenceEndpoint('test-image')).toBe(
    'https://localhost:27709/static-file/file/test-image'
  );
});

it('routes a production bundle through an explicitly selected local proxy', async () => {
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_LOCAL_SERVERS', 'ALL');
  vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', 'same-origin');
  vi.stubEnv('VITE_SYNC_SERVICE_HOST', '');
  vi.stubGlobal('location', new URL('https://localhost:3003'));
  vi.resetModules();
  const { SERVER_HOSTS, SYNC_SERVICE_HOSTS, SYNC_PERMISSION_TOKEN_DSS_HOST } =
    await import('./servers');

  expect(import.meta.env.DEV).toBe(false);
  expect(import.meta.env.MODE).toBe('production');
  expect(SERVER_HOSTS['auth-service']).toBe('https://localhost:3003/auth');
  expect(SERVER_HOSTS['document-storage-service']).toBe(
    'https://localhost:3003/dss'
  );
  expect(SERVER_HOSTS['connection-gateway']).toBe(
    'wss://localhost:3003/connection-gateway'
  );
  expect(SERVER_HOSTS['static-file']).toBe(
    'https://localhost:3003/static-file'
  );
  expect(SYNC_SERVICE_HOSTS).toEqual({
    worker: 'https://localhost:3003/sync',
    ws: 'wss://localhost:3003/sync',
  });
  expect(SYNC_PERMISSION_TOKEN_DSS_HOST).toBe('https://localhost:3003/dss');
});

it.each([
  ['', ''],
  ['ALL', ''],
  ['', 'same-origin'],
  ['document-storage-service,sync-service', 'same-origin'],
])(
  'keeps production remote without both ALL and a proxy: %s / %s',
  async (servers, origin) => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_LOCAL_SERVERS', servers);
    vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', origin);
    vi.stubEnv('VITE_SYNC_SERVICE_HOST', '');
    vi.stubGlobal('location', new URL('https://localhost:3003'));
    vi.resetModules();
    const { SERVER_HOSTS, SYNC_SERVICE_HOSTS, SYNC_PERMISSION_TOKEN_DSS_HOST } =
      await import('./servers');

    expect(SERVER_HOSTS['auth-service']).toBe('https://gateway.macro.com/auth');
    expect(SERVER_HOSTS['document-storage-service']).toBe(
      'https://gateway.macro.com/dss'
    );
    expect(SYNC_SERVICE_HOSTS).toEqual({
      worker: 'https://sync-service-prod2.macroverse.workers.dev',
      ws: 'wss://sync-service-prod2.macroverse.workers.dev',
    });
    expect(SYNC_PERMISSION_TOKEN_DSS_HOST).toBe(
      'https://gateway.macro.com/dss'
    );
  }
);

it.each([
  {
    local: false,
    override: '',
    sync: 'https://sync-service-prod2.macroverse.workers.dev',
    signer: 'https://gateway.macro.com/dss',
  },
  {
    local: false,
    override: 'sync.example.test',
    sync: 'https://sync.example.test',
    signer: 'https://gateway.macro.com/dss',
  },
  {
    local: true,
    override: '',
    sync: 'https://localhost:3003/sync',
    signer: 'https://localhost:3003/dss',
  },
  {
    local: true,
    override: 'sync.example.test',
    sync: 'https://sync.example.test',
    signer: 'https://gateway.macro.com/dss',
  },
])(
  'preserves production permission signing: local=$local override=$override',
  async ({ local, override, sync, signer }) => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_LOCAL_SERVERS', local ? 'ALL' : '');
    vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', local ? 'same-origin' : '');
    vi.stubEnv('VITE_SYNC_SERVICE_HOST', override);
    vi.stubGlobal('location', new URL('https://localhost:3003'));
    vi.resetModules();
    const { SYNC_SERVICE_HOSTS, SYNC_PERMISSION_TOKEN_DSS_HOST } = await import(
      './servers'
    );

    expect(SYNC_SERVICE_HOSTS.worker).toBe(sync);
    expect(SYNC_SERVICE_HOSTS.ws).toBe(sync.replace(/^http/, 'ws'));
    expect(SYNC_PERMISSION_TOKEN_DSS_HOST).toBe(signer);
  }
);

it('preserves development partial-service routing', async () => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('VITE_LOCAL_SERVERS', 'document-storage-service:8123');
  vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', 'same-origin');
  vi.stubEnv('VITE_SYNC_SERVICE_HOST', '');
  vi.stubGlobal('location', new URL('https://localhost:3003'));
  vi.resetModules();
  const { SERVER_HOSTS, SYNC_SERVICE_HOSTS, SYNC_PERMISSION_TOKEN_DSS_HOST } =
    await import('./servers');

  expect(SERVER_HOSTS['document-storage-service']).toBe(
    'http://localhost:8123'
  );
  expect(SERVER_HOSTS['auth-service']).toBe(
    'https://dev-gateway.macro.com/auth'
  );
  expect(SYNC_SERVICE_HOSTS.worker).toBe(
    'https://sync-service-dev3.macroverse.workers.dev'
  );
  expect(SYNC_PERMISSION_TOKEN_DSS_HOST).toBe(
    'https://dev-gateway.macro.com/dss'
  );
});

// Only a self-contained local stack's proxy keeps instances' cookies apart.
// `run_dev` serves the same proxy origin without those rules, and a hosted
// build must never take the handoff even if local settings leaked into it.
it.each([
  {
    name: 'run_local / just stack',
    mode: 'development',
    servers: 'ALL',
    backend: 'same-origin',
    stack: 'true',
    page: 'https://localhost:28009/app/login',
    expected: true,
  },
  {
    name: 'run_dev',
    mode: 'development',
    servers: 'ALL',
    backend: 'same-origin',
    stack: undefined,
    page: 'https://localhost:28009/app/login',
    expected: false,
  },
  {
    name: 'no proxy origin',
    mode: 'development',
    servers: 'ALL',
    backend: undefined,
    stack: 'true',
    page: 'https://localhost:28009/app/login',
    expected: false,
  },
  {
    name: 'hosted dev services',
    mode: 'development',
    servers: '',
    backend: 'same-origin',
    stack: 'true',
    page: 'https://localhost:28009/app/login',
    expected: false,
  },
  {
    name: 'production',
    mode: 'production',
    servers: undefined,
    backend: undefined,
    stack: undefined,
    page: 'https://macro.com/app/login',
    expected: false,
  },
  {
    name: 'production with leaked local settings',
    mode: 'production',
    servers: 'ALL',
    backend: 'same-origin',
    stack: 'true',
    page: 'https://macro.com/app/login',
    expected: false,
  },
])(
  'reports a local stack proxy for $name',
  async ({ mode, servers, backend, stack, page, expected }) => {
    vi.stubEnv('MODE', mode);
    vi.stubEnv('VITE_LOCAL_SERVERS', servers);
    vi.stubEnv('VITE_LOCAL_BACKEND_ORIGIN', backend);
    vi.stubEnv('VITE_LOCAL_STACK', stack);
    vi.stubGlobal('location', new URL(page));
    vi.resetModules();
    const { usesLocalStackProxy } = await import('./servers');
    expect(usesLocalStackProxy()).toBe(expected);
  }
);
