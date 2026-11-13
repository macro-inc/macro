import { describe, expect, it } from 'vitest';
import { keepImportMetaDev } from './keep-import-meta-dev';

describe('keepImportMetaDev', () => {
  it('keeps DEV for local-backend static builds (stack up)', () => {
    expect(
      keepImportMetaDev({
        command: 'build',
        mode: 'development',
        localBackendOrigin: 'same-origin',
      })
    ).toBe(true);
  });

  it('does not keep DEV for hosted build-dev', () => {
    expect(
      keepImportMetaDev({
        command: 'build',
        mode: 'development',
        localBackendOrigin: undefined,
      })
    ).toBe(false);
  });

  it('does not keep DEV for vite serve (already true natively)', () => {
    expect(
      keepImportMetaDev({
        command: 'serve',
        mode: 'development',
        localBackendOrigin: 'https://localhost:8090',
      })
    ).toBe(false);
  });

  it('keeps DEV false for an explicit production local proxy build', () => {
    expect(
      keepImportMetaDev({
        command: 'build',
        mode: 'production',
        localBackendOrigin: 'same-origin',
        localServers: 'ALL',
      })
    ).toBe(false);
  });

  it('keeps hosted production builds unchanged without a proxy', () => {
    expect(
      keepImportMetaDev({
        command: 'build',
        mode: 'production',
        localBackendOrigin: undefined,
        localServers: 'ALL',
      })
    ).toBe(false);
  });

  it.each([
    { command: 'serve', mode: 'production', localServers: 'ALL' },
    { command: 'build', mode: 'staging', localServers: 'ALL' },
    { command: 'build', mode: 'production', localServers: 'auth-service:8110' },
    { command: 'build', mode: 'production', localServers: '' },
    { command: 'build', mode: 'production', localServers: 'all' },
  ])('refuses unsupported proxy configurations: $command/$mode/$localServers', (options) => {
    expect(() =>
      keepImportMetaDev({ ...options, localBackendOrigin: 'same-origin' })
    ).toThrow(/refusing to keep import.meta.env.DEV/);
  });

  it('refuses a local-backend origin on a non-development MODE', () => {
    expect(() =>
      keepImportMetaDev({
        command: 'build',
        mode: 'production',
        localBackendOrigin: 'same-origin',
      })
    ).toThrow(/MODE=production/);
  });
});
