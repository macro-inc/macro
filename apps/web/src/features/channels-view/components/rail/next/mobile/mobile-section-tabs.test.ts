import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { describe, expect, it } from 'vitest';
import { mobileSectionMemberWindow } from './mobile-section-tabs';

const label = (channelIds: string[]) =>
  ({ id: 'section', channelIds }) as ChannelLabel;
const ids = (count: number, prefix = 'channel') =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
const windowIds = (window: ReturnType<typeof mobileSectionMemberWindow>) =>
  window.chunks.flatMap((chunk) => chunk.ids);
const nothingLoaded = () => false;

describe('mobileSectionMemberWindow', () => {
  it('looks up nothing without a selected section or before rows report', () => {
    const rows = { ids: ids(10), start: 0, end: 9 };
    expect(
      mobileSectionMemberWindow({
        label: undefined,
        rows,
        isLoaded: nothingLoaded,
        discover: [],
      }).size
    ).toBe(0);
    expect(
      mobileSectionMemberWindow({
        label: label(ids(10)),
        rows: undefined,
        isLoaded: nothingLoaded,
        discover: ids(10),
      }).size
    ).toBe(0);
  });

  it('looks up the blocks on screen that no live list holds', () => {
    const list = ids(200);
    const window = mobileSectionMemberWindow({
      label: label(list),
      rows: { ids: list, start: 60, end: 70 },
      isLoaded: (id) => id === 'channel-60',
      discover: [],
    });
    // Rows 54-76 with overscan, widened to blocks 50-74 and 75-99.
    expect(windowIds(window)).toEqual(
      list.slice(50, 100).filter((id) => id !== 'channel-60')
    );
  });

  it('looks up as much on screen in a 7,000-member section as in a small one', () => {
    const lookup = (size: number) =>
      mobileSectionMemberWindow({
        label: label(ids(size)),
        rows: { ids: ids(size), start: 0, end: 11 },
        isLoaded: nothingLoaded,
        discover: [],
      }).size;
    expect(lookup(7000)).toBe(25);
    expect(lookup(3500)).toBe(25);
  });

  it('looks up the members to discover only once the end is on screen', () => {
    const shown = ids(30);
    const discover = ids(25, 'unknown');
    const at = (start: number, end: number) =>
      windowIds(
        mobileSectionMemberWindow({
          label: label([...shown, ...ids(500, 'unknown')]),
          rows: { ids: shown, start, end },
          isLoaded: () => true,
          discover,
        })
      );
    expect(at(0, 11)).toEqual([]);
    expect(at(18, 29)).toEqual(discover);
  });

  it('discovers members from an empty list, whose end is on screen', () => {
    const discover = ids(25, 'unknown');
    const window = mobileSectionMemberWindow({
      label: label(ids(7000, 'unknown')),
      rows: { ids: [], start: 0, end: 0 },
      isLoaded: nothingLoaded,
      discover,
    });
    expect(windowIds(window)).toEqual(discover);
  });
});
