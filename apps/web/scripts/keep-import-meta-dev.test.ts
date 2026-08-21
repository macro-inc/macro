import { describe, expect, it } from 'vitest';
import { keepImportMetaDev } from './keep-import-meta-dev';

describe('keepImportMetaDev', () => {
  it('keeps DEV for local-backend static builds (stack up, Fly preview)', () => {
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
        localBackendOrigin: 'http://localhost:8090',
      })
    ).toBe(false);
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
