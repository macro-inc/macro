import { describe, expect, it } from 'vitest';
import { getStickyHeader, getStickyScrollOptions } from './sticky-header';

const GEOMETRY = {
  scrollOffset: 0,
  viewportSize: 200,
  getItemOffset: (index: number) => index * 40,
  getItemSize: () => 40,
};

describe('sticky group geometry', () => {
  it('pins only headers that have reached the viewport edge', () => {
    const layout = {
      indexes: [2, 10],
      geometry: { ...GEOMETRY, scrollOffset: 79 },
      startMargin: 0,
      inset: 0,
    };
    expect(getStickyHeader(layout)).toBeUndefined();
    expect(
      getStickyHeader({
        ...layout,
        geometry: { ...GEOMETRY, scrollOffset: 80 },
      })
    ).toEqual({ index: 2, top: 0 });
    expect(getStickyHeader({ ...layout, indexes: [] })).toBeUndefined();
  });

  it('pushes out the previous header and replaces it at the group boundary', () => {
    const layout = {
      indexes: [0, 10],
      geometry: { ...GEOMETRY, scrollOffset: 375 },
      startMargin: 0,
      inset: 0,
    };
    expect(getStickyHeader(layout)).toEqual({ index: 0, top: -15 });
    expect(
      getStickyHeader({
        ...layout,
        geometry: { ...GEOMETRY, scrollOffset: 400 },
      })
    ).toEqual({ index: 10, top: 0 });
  });

  it('separates the in-flow spacer from persistent mobile chrome', () => {
    const layout = {
      indexes: [0, 10],
      geometry: { ...GEOMETRY, scrollOffset: 375 },
      startMargin: 64,
      inset: 64,
    };
    expect(getStickyHeader(layout)).toEqual({ index: 0, top: 49 });
    expect(getStickyHeader({ ...layout, inset: 0 })).toEqual({
      index: 0,
      top: 0,
    });
    expect(
      getStickyHeader({
        ...layout,
        geometry: { ...GEOMETRY, scrollOffset: 400 },
      })
    ).toEqual({ index: 10, top: 64 });
  });

  it('handles adjacent collapsed groups and variable header heights', () => {
    expect(
      getStickyHeader({
        indexes: [0, 1, 2],
        geometry: {
          ...GEOMETRY,
          scrollOffset: 45,
          getItemSize: () => 44,
        },
        startMargin: 0,
        inset: 0,
      })
    ).toEqual({ index: 1, top: -9 });
  });
});

describe('keyboard scrolling beneath sticky headers', () => {
  const layout = {
    indexes: [0, 10],
    geometry: { ...GEOMETRY, scrollOffset: 50 },
    startMargin: 0,
    inset: 0,
  };

  it('reveals a row that nearest scrolling considers visible behind a header', () => {
    expect(getStickyScrollOptions(layout, 2, { align: 'nearest' })).toEqual({
      align: 'start',
      offset: -40,
    });
    expect(
      getStickyScrollOptions(layout, 3, { align: 'nearest' })
    ).toBeUndefined();
    expect(
      getStickyScrollOptions(layout, 0, { align: 'nearest' })
    ).toBeUndefined();
  });

  it('keeps downward navigation aligned to the bottom edge', () => {
    expect(
      getStickyScrollOptions(layout, 7, { align: 'nearest', smooth: true })
    ).toEqual({ align: 'end', smooth: true });
  });

  it('reserves the destination group header instead of the current header', () => {
    const destination = {
      ...layout,
      geometry: {
        ...layout.geometry,
        getItemSize: (index: number) => (index === 10 ? 44 : 40),
      },
    };
    expect(getStickyScrollOptions(destination, 11, { align: 'start' })).toEqual(
      {
        align: 'start',
        offset: -44,
      }
    );
    expect(getStickyScrollOptions(destination, 10, { align: 'start' })).toEqual(
      {
        align: 'start',
        offset: 0,
      }
    );
  });

  it('keeps mobile targets below chrome and preserves explicit offsets', () => {
    const mobile = { ...layout, startMargin: 64, inset: 64 };
    expect(
      getStickyScrollOptions(mobile, 2, { align: 'nearest', offset: 4 })
    ).toEqual({ align: 'start', offset: -100 });
    expect(
      getStickyScrollOptions(mobile, 11, { align: 'center', offset: 4 })
    ).toEqual({ align: 'center', offset: 4 });
  });
});
