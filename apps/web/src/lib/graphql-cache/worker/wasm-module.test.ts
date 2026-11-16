import { describe, expect, it } from 'vitest';
import {
  CacheWasmUnavailableError,
  cacheWasmDownloadError,
} from './wasm-module';

describe('cacheWasmDownloadError', () => {
  it.each([403, 404, 410])(
    'treats HTTP %i as a binary the deployment no longer serves',
    (status) => {
      const error = cacheWasmDownloadError(status);
      expect(error).toBeInstanceOf(CacheWasmUnavailableError);
      expect(error.message).toBe(`cache WASM download returned HTTP ${status}`);
    }
  );

  it.each([408, 429, 500, 502, 503])('keeps HTTP %i retryable', (status) => {
    const error = cacheWasmDownloadError(status);
    expect(error).not.toBeInstanceOf(CacheWasmUnavailableError);
    expect(error.message).toBe(`cache WASM download returned HTTP ${status}`);
  });
});
