import type { ChannelEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  applySupportChannelVisibility,
  isSupportChannel,
  isSupportChannelName,
  SUPPORT_CHANNEL_NAME_PREFIX,
} from './support-channels';

const channel = (
  id: string,
  name: string,
  channelType: ChannelEntity['channelType'] = 'private'
): ChannelEntity => ({
  id,
  name,
  type: 'channel',
  ownerId: 'viewer',
  channelType,
});

const support = channel('support', 'Macro Support x acme');
const team = channel('eng', 'Engineering', 'team');
const hashed = channel('hashed', '#Macro Support x acme');

describe('isSupportChannelName', () => {
  it('matches the seeded support conversation prefix', () => {
    expect(isSupportChannelName(`${SUPPORT_CHANNEL_NAME_PREFIX}ada`)).toBe(
      true
    );
    expect(isSupportChannelName('#Macro Support x ada')).toBe(true);
    expect(isSupportChannelName('Engineering')).toBe(false);
    expect(isSupportChannelName('Macro Support')).toBe(false);
    expect(isSupportChannelName(undefined)).toBe(false);
    expect(isSupportChannelName(null)).toBe(false);
  });
});

describe('applySupportChannelVisibility', () => {
  it('leaves search and visible lists unchanged', () => {
    expect(
      applySupportChannelVisibility('search', [support, team], [], true)
    ).toEqual([support, team]);
    expect(
      applySupportChannelVisibility('channels', [support, team], [], false)
    ).toEqual([support, team]);
  });

  it('drops support conversations from Chat lists', () => {
    expect(
      applySupportChannelVisibility(
        'recents',
        [support, team, hashed],
        [],
        true
      )
    ).toEqual([team]);
  });

  it('fills All from the complete list when hiding support', () => {
    const extra = channel('internal', 'Internal', 'team');
    expect(
      applySupportChannelVisibility('channels', [support], [extra, team], true)
    ).toEqual([extra, team]);
  });
});

describe('isSupportChannel', () => {
  it('uses the conversation name', () => {
    expect(isSupportChannel(support)).toBe(true);
    expect(isSupportChannel(team)).toBe(false);
  });
});
