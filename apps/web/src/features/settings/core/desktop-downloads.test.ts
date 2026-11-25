import { describe, expect, it } from 'vitest';
import {
  desktopInstallers,
  detectDesktopPlatform,
  intelMacPublished,
  readMacArchitecture,
} from './desktop-downloads';

describe('detectDesktopPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0)', 'linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', undefined],
    ['Mozilla/5.0 (X11; CrOS x86_64)', undefined],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', undefined],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', undefined],
    ['', undefined],
  ])('reads %s as %s', (userAgent, platform) => {
    expect(detectDesktopPlatform(userAgent)).toBe(platform);
  });
});

describe('intelMacPublished', () => {
  it('offers Intel only once the website links to its installer', () => {
    expect(intelMacPublished({ '/download/mac': 'a' })).toBe(false);
    expect(
      intelMacPublished({ '/download/mac': 'a', '/download/mac-intel': 'b' })
    ).toBe(true);
  });
});

describe('readMacArchitecture', () => {
  const answering = (value: Promise<{ architecture?: string }>) => ({
    getHighEntropyValues: () => value,
  });

  it.each([
    ['arm', 'arm'],
    ['x86', 'x86'],
    ['', undefined],
    [undefined, undefined],
  ])('reads %s as %s', async (architecture, expected) => {
    expect(
      await readMacArchitecture(answering(Promise.resolve({ architecture })))
    ).toBe(expected);
  });

  it('knows nothing without the hint or when the browser refuses it', async () => {
    expect(await readMacArchitecture(undefined)).toBeUndefined();
    expect(
      await readMacArchitecture(answering(Promise.reject(new Error('denied'))))
    ).toBeUndefined();
  });
});

describe('desktopInstallers', () => {
  it('offers one Mac installer until Intel is published', () => {
    expect(
      desktopInstallers({ system: 'macos', architecture: 'x86', intel: false })
    ).toEqual(['macos', 'linux']);
  });

  it('leads with the Mac architecture the browser reports, else Apple silicon', () => {
    expect(
      desktopInstallers({ system: 'macos', architecture: 'x86', intel: true })
    ).toEqual(['macos-intel', 'macos', 'linux']);
    expect(
      desktopInstallers({ system: 'macos', architecture: 'arm', intel: true })
    ).toEqual(['macos', 'macos-intel', 'linux']);
    expect(
      desktopInstallers({
        system: undefined,
        architecture: undefined,
        intel: true,
      })
    ).toEqual(['macos', 'macos-intel', 'linux']);
  });

  it('keeps both Mac installers together after Linux on Linux', () => {
    expect(
      desktopInstallers({
        system: 'linux',
        architecture: undefined,
        intel: true,
      })
    ).toEqual(['linux', 'macos', 'macos-intel']);
  });
});
