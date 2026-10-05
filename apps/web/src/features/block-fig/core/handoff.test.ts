import type {
  LayoutAids,
  LayoutGridInfo,
} from '@core/fig-engine/handoff-types';
import { describe, expect, it } from 'vitest';
import {
  defaultSetting,
  exportFileName,
  exportPixelSize,
  nextSetting,
  parseSize,
  sizeLabel,
} from './export-settings';
import { gridShapes, sections, snapLines, snapResize } from './layout-grid';
import { snapMove } from './snap';
import { spacingRegions } from './spacing';

const grid = (g: Partial<LayoutGridInfo>): LayoutGridInfo => ({
  pattern: 'STRIPES',
  axis: 'X',
  align: 'STRETCH',
  visible: true,
  count: 5,
  offset: 0,
  sectionSize: 10,
  gutter: 20,
  color: 'FF0000',
  alpha: 0.1,
  ...g,
});

describe('export presets', () => {
  it('parses and labels sizes as Figma does', () => {
    expect(parseSize('2x')).toEqual({ constraint: 'CONTENT_SCALE', value: 2 });
    expect(parseSize('0.5')).toEqual({
      constraint: 'CONTENT_SCALE',
      value: 0.5,
    });
    expect(parseSize('512W')).toEqual({
      constraint: 'CONTENT_WIDTH',
      value: 512,
    });
    expect(parseSize(' 300 h ')).toEqual({
      constraint: 'CONTENT_HEIGHT',
      value: 300,
    });
    expect(parseSize('big')).toBeUndefined();
    expect(parseSize('0x')).toBeUndefined();
    expect(sizeLabel({ ...defaultSetting(), value: 1.5 })).toBe('1.5x');
    expect(
      sizeLabel({ ...defaultSetting(), constraint: 'CONTENT_WIDTH', value: 64 })
    ).toBe('64w');
  });

  it('adds 1x first, then the next scale up', () => {
    const first = nextSetting([]);
    expect(first).toMatchObject({ format: 'PNG', value: 1 });
    const second = nextSetting([first]);
    expect(second.value).toBe(2);
    expect(nextSetting([first, second]).value).toBe(3);
    const svg = { ...defaultSetting('SVG') };
    expect(nextSetting([svg]).format).toBe('SVG');
  });

  it('names files like the engine', () => {
    expect(exportFileName('Icon', defaultSetting())).toBe('Icon.png');
    expect(exportFileName('Icon', defaultSetting('PNG', 2))).toBe(
      'Icon@2x.png'
    );
    expect(
      exportFileName('icons/close', { ...defaultSetting('SVG'), suffix: '-x' })
    ).toBe('icons/close-x.svg');
    expect(exportFileName('A:B', defaultSetting('JPEG'))).toBe('A-B.jpg');
    expect(exportFileName('', defaultSetting('PDF'))).toBe('Untitled.pdf');
  });

  it('sizes images by scale, width, or height', () => {
    expect(exportPixelSize(defaultSetting('PNG', 2), 50, 20)).toEqual({
      w: 100,
      h: 40,
    });
    expect(
      exportPixelSize(
        { ...defaultSetting(), constraint: 'CONTENT_WIDTH', value: 200 },
        50,
        20
      )
    ).toEqual({ w: 200, h: 80 });
  });
});

describe('layout grids', () => {
  it('stretches columns between margins', () => {
    const s = sections(
      grid({ count: 4, offset: 20, gutter: 10, align: 'STRETCH' }),
      450
    );
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ start: 20, size: 95 });
    expect(s[3].start + s[3].size).toBeCloseTo(430);
  });

  it('places fixed columns from either side or centered', () => {
    const min = sections(
      grid({ align: 'MIN', count: 2, sectionSize: 50, gutter: 10, offset: 5 }),
      300
    );
    expect(min.map((s) => s.start)).toEqual([5, 65]);
    const max = sections(
      grid({ align: 'MAX', count: 2, sectionSize: 50, gutter: 10, offset: 5 }),
      300
    );
    expect(max.map((s) => s.start)).toEqual([185, 245]);
    const center = sections(
      grid({ align: 'CENTER', count: 2, sectionSize: 50, gutter: 10 }),
      300
    );
    expect(center.map((s) => s.start)).toEqual([95, 155]);
  });

  it('fits as many sections as it can for Auto', () => {
    const auto = sections(
      grid({ align: 'MIN', count: 0, sectionSize: 40, gutter: 10 }),
      200
    );
    expect(auto).toHaveLength(4);
  });

  it('draws rows across and square grids as lines', () => {
    const rows = gridShapes(
      grid({ axis: 'Y', align: 'MIN', count: 1, sectionSize: 30, offset: 10 }),
      100,
      200
    );
    expect(rows.bands).toEqual([{ x: 0, y: 10, w: 100, h: 30 }]);
    const square = gridShapes(
      grid({ pattern: 'GRID', sectionSize: 25 }),
      100,
      60
    );
    expect(square.xs).toEqual([25, 50, 75]);
    expect(square.ys).toEqual([25, 50]);
  });

  const aids: LayoutAids = {
    guides: [{ axis: 'X', offset: 500 }],
    frames: [
      {
        id: '1:2',
        transform: [1, 0, 0, 1, 100, 50],
        width: 200,
        height: 100,
        grids: [
          grid({
            align: 'MIN',
            count: 2,
            sectionSize: 40,
            gutter: 20,
            offset: 10,
          }),
        ],
        guides: [{ axis: 'Y', offset: 30 }],
      },
    ],
  };

  it('snaps to grid edges and guides in page space', () => {
    const near = { x: 100, y: 50, w: 10, h: 10 };
    const lines = snapLines(aids, near, { grids: true, guides: true });
    expect(lines.x.sort((a, b) => a - b)).toEqual([110, 150, 170, 210, 500]);
    expect(lines.y).toEqual([80]);
    const off = snapLines(aids, near, { grids: false, guides: false });
    expect(off).toEqual({ x: [], y: [] });
    // Frames away from the layer do not attract it.
    const far = snapLines(
      aids,
      { x: 1000, y: 1000, w: 1, h: 1 },
      {
        grids: true,
        guides: true,
      }
    );
    expect(far.x).toEqual([500]);

    const moved = snapMove({ x: 0, y: 0, w: 20, h: 20 }, 107, 0, [], 4, lines);
    expect(moved.dx).toBe(110);
    expect(moved.guides[0]).toMatchObject({ axis: 'x', at: 110 });

    expect(snapResize({ x: 100, y: 50, w: 47, h: 20 }, 'e', lines, 4)).toEqual({
      x: 100,
      y: 50,
      w: 50,
      h: 20,
    });
  });
});

describe('spacing', () => {
  it('shades padding and the gaps between children', () => {
    const regions = spacingRegions(
      { x: 0, y: 0, w: 100, h: 40 },
      {
        mode: 'HORIZONTAL',
        spacing: 10,
        paddingTop: 5,
        paddingRight: 8,
        paddingBottom: 5,
        paddingLeft: 8,
        primaryAlign: null,
        counterAlign: null,
        wrap: false,
        primarySizing: null,
        counterSizing: null,
        counterSpacing: 0,
        reverseZ: false,
      },
      [
        { x: 48, y: 5, w: 20, h: 30 },
        { x: 8, y: 5, w: 30, h: 30 },
      ]
    );
    const gaps = regions.filter((r) => r.kind === 'gap');
    expect(gaps).toEqual([
      { kind: 'gap', value: 10, rect: { x: 38, y: 5, w: 10, h: 30 } },
    ]);
    expect(regions.filter((r) => r.kind === 'padding')).toHaveLength(4);
  });
});
