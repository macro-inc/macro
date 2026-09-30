import { describe, expect, it } from 'vitest';
import { localDevServer } from './local-dev-server';

describe('localDevServer', () => {
  it('lets browser HMR infer the page origin and leaves hosted dev unproxied', () => {
    expect(localDevServer({})).toEqual({ hmr: undefined });
  });

  it('preserves the explicit Tauri device host', () => {
    expect(localDevServer({ TAURI_DEV_HOST: '192.168.1.20' }).hmr).toEqual({
      host: '192.168.1.20',
      protocol: 'ws',
    });
  });

  it('routes HTTP and bare/query-string WebSockets without swallowing frontend paths', () => {
    const target = 'http://localhost:20109';
    const config = localDevServer({
      MACRO_LOCAL_BACKEND_PROXY: target,
      MACRO_LOCAL_HOSTNAME: 'Coworker-Dev',
      MACRO_LOCAL_BACKEND_ROUTES:
        '/auth,/connection-gateway,/websocket,/sync,/ai-editing,/i,/static-file',
    });
    const rules = Object.keys(config.proxy ?? {}).map((key) => new RegExp(key));
    for (const path of [
      '/auth/health',
      '/connection-gateway?token=test',
      '/websocket',
      '/sync/document',
      '/ai-editing/edit',
      '/i/otlp/v1/traces',
      '/static-file/file.pdf',
    ]) {
      expect(
        rules.some((rule) => rule.test(path)),
        path
      ).toBe(true);
    }
    for (const path of [
      '/app/',
      '/@vite/client',
      '/src/main.tsx',
      '/?token=hmr',
      '/authentic',
      '/sync-other',
    ]) {
      expect(
        rules.some((rule) => rule.test(path)),
        path
      ).toBe(false);
    }
    for (const options of Object.values(config.proxy ?? {})) {
      expect(options).toEqual({
        target,
        ws: true,
        xfwd: true,
        changeOrigin: true,
      });
    }
    expect(config.hmr).toBeUndefined();
    expect(config.allowedHosts).toEqual(['coworker-dev']);
  });

  it('binds loopback and admits a configured public HTTPS hostname', () => {
    const target = 'https://localhost:8090';
    const config = localDevServer({
      LOCAL_PUBLIC_ORIGIN: 'https://forge.tail66c63e.ts.net:3000',
      MACRO_LOCAL_BACKEND_PROXY: target,
      MACRO_LOCAL_BACKEND_ROUTES: '/auth,/sync,/s3,/oauth2',
      MACRO_LOCAL_HOSTNAME: 'local-workstation',
    });

    expect(config.host).toBe('127.0.0.1');
    expect(config.allowedHosts).toEqual([
      'local-workstation',
      'forge.tail66c63e.ts.net',
    ]);
    expect(config.hmr).toBeUndefined();
    for (const options of Object.values(config.proxy ?? {})) {
      expect(options).toEqual({
        target,
        ws: true,
        xfwd: true,
        changeOrigin: true,
      });
    }
  });

  it('rejects missing or malformed routing metadata instead of proxying everything', () => {
    for (const routes of [undefined, '', '/', '/auth,', '/auth|/app']) {
      expect(() =>
        localDevServer({
          MACRO_LOCAL_BACKEND_PROXY: 'http://localhost:20109',
          MACRO_LOCAL_BACKEND_ROUTES: routes,
        })
      ).toThrow(/MACRO_LOCAL_BACKEND_ROUTES/);
    }
  });

  it('rejects malformed public origins and non-loopback public upstreams', () => {
    for (const origin of [
      'http://forge:3000',
      'https://forge/app',
      'https://user@forge',
      'https://.example.com',
      'https://*.example.com',
    ]) {
      expect(() =>
        localDevServer({
          LOCAL_PUBLIC_ORIGIN: origin,
          MACRO_LOCAL_BACKEND_PROXY: 'https://localhost:8090',
          MACRO_LOCAL_BACKEND_ROUTES: '/auth',
        })
      ).toThrow();
    }
    for (const target of [
      'https://remote.example',
      'http://remote.example:8090',
      'https://localhost:8090/path',
    ]) {
      expect(() =>
        localDevServer({
          LOCAL_PUBLIC_ORIGIN: 'https://forge.tail66c63e.ts.net:3000',
          MACRO_LOCAL_BACKEND_PROXY: target,
          MACRO_LOCAL_BACKEND_ROUTES: '/auth',
        })
      ).toThrow();
    }
  });
});
