import { describe, expect, it } from 'vitest';
import {
  channelCallHandoffPath,
  meetingConnectMetadata,
  meetingMediaPath,
} from './meeting-media-path';

describe('meeting media path', () => {
  it.each([
    { nativeIosCalls: true, member: true, channelId: null, path: 'native' },
    { nativeIosCalls: true, member: false, channelId: null, path: 'browser' },
    {
      nativeIosCalls: true,
      member: true,
      channelId: 'channel-1',
      path: 'browser',
    },
    { nativeIosCalls: false, member: true, channelId: null, path: 'browser' },
  ] as const)(
    'uses $path media (iOS app=$nativeIosCalls, member=$member, channel=$channelId)',
    ({ path, ...meeting }) => {
      expect(meetingMediaPath(meeting)).toBe(path);
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

  it('joins a live channel-linked meeting in its channel from the iOS app', () => {
    const live = {
      member: true,
      nativeIosCalls: true,
      channelId: 'channel-1',
      callId: '01a1f517-3048-7a99-afa9-5de4b147bf2f',
    };
    expect(channelCallHandoffPath(live)).toBe(
      '/channel/channel-1?join_call=01a1f517-3048-7a99-afa9-5de4b147bf2f'
    );
    expect(channelCallHandoffPath({ ...live, callId: null })).toBeUndefined();
    expect(
      channelCallHandoffPath({ ...live, channelId: null })
    ).toBeUndefined();
    expect(channelCallHandoffPath({ ...live, member: false })).toBeUndefined();
    expect(
      channelCallHandoffPath({ ...live, nativeIosCalls: false })
    ).toBeUndefined();
  });
});
