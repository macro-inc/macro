import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pickFile = vi.fn();
const remove = vi.fn();
let isPending = false;
let cachedPictureId: string | null | undefined;

vi.mock('@channel/channel-picture', () => ({
  useChannelPictureEditor: () => ({
    isPending: () => isPending,
    pickFile,
    remove,
  }),
}));
vi.mock('@queries/channel/picture', () => ({
  createCachedChannelPicture: () => () => cachedPictureId,
}));

import { makeChannelPictureAction } from './make-channel-picture-action';

const channel = (
  overrides: Partial<Extract<EntityData, { type: 'channel' }>> = {}
) =>
  ({
    type: 'channel',
    id: 'c1',
    name: 'Design',
    ownerId: 'macro|other@example.com',
    channelType: 'private',
    ...overrides,
  }) as EntityData;

beforeEach(() => {
  vi.clearAllMocks();
  isPending = false;
  cachedPictureId = undefined;
});

describe('makeChannelPictureAction.canExecute', () => {
  it('allows any participant of a named channel, matching Rename', () => {
    const { canExecute } = makeChannelPictureAction();
    expect(canExecute(channel({ isParticipant: true }))).toBe(true);
    expect(canExecute(channel({ channelType: 'team' }))).toBe(true);
  });

  it('refuses direct messages and channels the viewer has not joined', () => {
    const { canExecute } = makeChannelPictureAction();
    expect(canExecute(channel({ channelType: 'direct_message' }))).toBe(false);
    expect(
      canExecute(channel({ channelType: 'team', isParticipant: false }))
    ).toBe(false);
  });

  it('refuses entities that are not channels', () => {
    const { canExecute } = makeChannelPictureAction();
    expect(canExecute({ type: 'document', id: 'd1' } as EntityData)).toBe(
      false
    );
  });

  it('refuses while an upload is still settling', () => {
    isPending = true;
    const { canExecute } = makeChannelPictureAction();
    expect(canExecute(channel())).toBe(false);
  });
});

describe('makeChannelPictureAction.hasPicture', () => {
  it('reports a picture the cache already knows about', () => {
    cachedPictureId = 'picture-1';
    expect(makeChannelPictureAction().hasPicture(channel())).toBe(true);
  });

  it('stays quiet for an unknown or absent picture', () => {
    const { hasPicture } = makeChannelPictureAction();
    expect(hasPicture(channel())).toBe(false);
    cachedPictureId = null;
    expect(hasPicture(channel())).toBe(false);
  });
});

describe('makeChannelPictureAction.execute', () => {
  it('opens the picker for the one channel it was given', () => {
    makeChannelPictureAction().execute([channel()]);
    expect(pickFile).toHaveBeenCalledWith('c1');
  });

  it('does nothing for a multi-row selection or an ineligible channel', () => {
    const { execute } = makeChannelPictureAction();
    execute([channel(), channel({ id: 'c2' })]);
    execute([channel({ channelType: 'direct_message' })]);
    execute([]);
    expect(pickFile).not.toHaveBeenCalled();
  });
});

describe('makeChannelPictureAction.remove', () => {
  it('clears a picture the cache knows about', () => {
    cachedPictureId = 'picture-1';
    makeChannelPictureAction().remove([channel()]);
    expect(remove).toHaveBeenCalledWith('c1');
  });

  it('does nothing when there is no picture to clear', () => {
    makeChannelPictureAction().remove([channel()]);
    expect(remove).not.toHaveBeenCalled();
  });
});
