import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { describe, expect, it } from 'vitest';
import { mobileSectionMemberWindow } from './mobile-section-tabs';

const channel = (id: string) =>
  ({ id, type: 'channel', name: id }) as ChannelEntity;
const label = (channelIds: string[]) =>
  ({ id: 'section', channelIds }) as ChannelLabel;
const windowIds = (window: ReturnType<typeof mobileSectionMemberWindow>) =>
  window.chunks.flatMap((chunk) => chunk.ids);

describe('mobileSectionMemberWindow', () => {
  it('looks up nothing without a selected section', () => {
    expect(mobileSectionMemberWindow(undefined, []).size).toBe(0);
  });

  it('looks up only the members no loaded list holds', () => {
    const window = mobileSectionMemberWindow(label(['one', 'two', 'three']), [
      [channel('one')],
      [channel('three')],
    ]);
    expect(windowIds(window)).toEqual(['two']);
  });

  it('looks up at most 200 members of a large section', () => {
    const ids = Array.from({ length: 7000 }, (_, index) => `channel-${index}`);
    const pool = ids.slice(0, 3500).map(channel);
    const window = mobileSectionMemberWindow(label(ids), [pool]);
    expect(window.size).toBe(200);
    expect(window.dropped).toBe(3300);
    expect(windowIds(window)).toEqual(ids.slice(3500, 3700));
  });

  it('looks up nothing once the directory holds every member', () => {
    const ids = Array.from({ length: 7000 }, (_, index) => `channel-${index}`);
    expect(mobileSectionMemberWindow(label(ids), [ids.map(channel)]).size).toBe(
      0
    );
  });
});
