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
      expect(options).toEqual({ target, ws: true, xfwd: true });
    }
    expect(config.hmr).toBeUndefined();
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
});
