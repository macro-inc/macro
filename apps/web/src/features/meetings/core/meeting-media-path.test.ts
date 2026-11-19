import { describe, expect, it, vi } from 'vitest';
import { meetingConnectMetadata, meetingMediaPath } from './meeting-media-path';

const platform = vi.hoisted(() => ({
  os: 'ios',
  native: true,
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLKIT: true }));
vi.mock('@core/util/platform', () => ({
  isTauri: () => platform.native,
  isPlatform: (os: string) => os === platform.os,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ version: () => '16' }));

describe('meeting media path', () => {
  it.each([
    {
      where: 'the iOS app',
      os: 'ios',
      native: true,
      member: true,
      path: 'native',
    },
    {
      where: 'the iOS app',
      os: 'ios',
      native: true,
      member: false,
      path: 'browser',
    },
    {
      where: 'the Android app',
      os: 'android',
      native: true,
      member: true,
      path: 'browser',
    },
    {
      where: 'the desktop app',
      os: 'macos',
      native: true,
      member: true,
      path: 'browser',
    },
    {
      where: 'Safari on iOS',
      os: 'ios',
      native: false,
      member: true,
      path: 'browser',
    },
    {
      where: 'the web',
      os: 'linux',
      native: false,
      member: true,
      path: 'browser',
    },
  ])(
    'uses $path media in $where (member=$member)',
    ({ os, native, member, path }) => {
      platform.os = os;
      platform.native = native;
      window.__MACRO_ANDROID_CALL_KIT__ = true;
      expect(meetingMediaPath(member)).toBe(path);
      delete window.__MACRO_ANDROID_CALL_KIT__;
    }
  );

  it('keys native meetings by call and names them on the call screen', () => {
    expect(
      meetingConnectMetadata('native', {
        callId: '01A1F517-3048-7A99-AFA9-5DE4B147BF2F',
        title: '  ',
      })
    ).toEqual({
      nativeCallKey: 'meeting:01a1f517-3048-7a99-afa9-5de4b147bf2f',
      channelTitle: 'Call',
    });
    expect(
      meetingConnectMetadata('browser', { callId: 'call-1', title: 'Sync' })
    ).toEqual({ useBrowserSession: true });
  });
});
