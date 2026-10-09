import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { nativeUpdateLink, openNativeUpdateLink } from './native-update-link';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('native update destination', () => {
  it('targets the production Android package using HTTPS', () => {
    const url = new URL(nativeUpdateLink('android'));
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('play.google.com');
    expect(url.searchParams.get('id')).toBe('com.macro.workspace.mobile');
    expect(nativeUpdateLink('ios')).toContain('id6743133649');
  });

  it('keeps opener failures recoverable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error('No handler'))
      .mockResolvedValueOnce(undefined);
    expect(await openNativeUpdateLink('android')).toBe(false);
    expect(await openNativeUpdateLink('android')).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('plugin:opener|open_url', {
      url: nativeUpdateLink('android'),
    });
    vi.restoreAllMocks();
  });
});
