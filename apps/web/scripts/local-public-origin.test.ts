import { describe, expect, it } from 'vitest';
import { localPublicOriginServer } from './local-public-origin';

const publicOrigin = 'https://forge.tail66c63e.ts.net:3000';
const proxyTarget = 'http://127.0.0.1:8090';

describe('local HTTPS Vite proxy', () => {
  it('defaults to browser-derived HMR without a local proxy', () => {
    expect(localPublicOriginServer({})).toEqual({ hmr: undefined });
    expect(localPublicOriginServer({ tauriHost: '192.0.2.1' })).toEqual({
      hmr: { host: '192.0.2.1' },
    });
  });

  it('binds loopback instead of colliding with Tailscale on the same port', () => {
    const server = {
      host: '0.0.0.0',
      ...localPublicOriginServer({ publicOrigin, proxyTarget }),
    };
    expect(server.host).toBe('127.0.0.1');
    expect({ host: '0.0.0.0', ...localPublicOriginServer({}) }.host).toBe(
      '0.0.0.0'
    );
  });

  it('allows one host and proxies only backend prefixes including websocket upgrades', () => {
    const config = localPublicOriginServer({ publicOrigin, proxyTarget });
    expect(config.allowedHosts).toEqual(['forge.tail66c63e.ts.net']);
    expect(config.hmr).toBeUndefined();
    const routes = Object.keys(config.proxy ?? {}).map(
      (key) => new RegExp(key)
    );
    for (const path of [
      '/auth/login',
      '/sync',
      '/sync?document=x',
      '/websocket',
      '/s3/bucket/key',
      '/oauth2/authorize',
    ]) {
      expect(
        routes.some((route) => route.test(path)),
        path
      ).toBe(true);
    }
    for (const path of [
      '/app',
      '/app/doc/id',
      '/@vite/client',
      '/src/index.tsx',
      '/sync-evil',
      '/api/application',
      '/admin',
    ]) {
      expect(
        routes.some((route) => route.test(path)),
        path
      ).toBe(false);
    }
    for (const proxy of Object.values(config.proxy ?? {})) {
      expect(proxy).toEqual({
        target: proxyTarget,
        ws: true,
        changeOrigin: false,
      });
    }
  });

  it('rejects non-origins, wildcard hosts, and non-loopback upstreams', () => {
    for (const origin of [
      'http://forge:3000',
      'https://forge/app',
      'https://user@forge',
      'https://.example.com',
      'https://*.example.com',
    ]) {
      expect(() =>
        localPublicOriginServer({ publicOrigin: origin, proxyTarget })
      ).toThrow();
    }
    for (const target of [
      'https://remote.example',
      'http://remote.example:8090',
      'http://127.0.0.1:8090/path',
    ]) {
      expect(() =>
        localPublicOriginServer({ publicOrigin, proxyTarget: target })
      ).toThrow();
    }
  });
});
