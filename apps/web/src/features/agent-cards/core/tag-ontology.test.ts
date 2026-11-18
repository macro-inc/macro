import { DEFAULT_TAG_COLOR } from '@app/features/property/tags/tagColors';
import { describe, expect, it, vi } from 'vitest';
import { type KnownTag, ontologyRows, paletteColor } from './tag-ontology';

const unknown = () => undefined;

describe('paletteColor', () => {
  it.each([
    ['red', '#E5484D'],
    ['Indigo', '#3E63DD'],
    [' teal ', '#12A594'],
    ['#46a758', '#46A758'],
  ])('reads %j as the palette colour %s', (color, hex) => {
    expect(paletteColor(color)).toBe(hex);
  });

  it.each([undefined, '', 'chartreuse', '#123456'])(
    'reads %j as no colour',
    (color) => {
      expect(paletteColor(color)).toBeUndefined();
    }
  );
});

describe('ontologyRows', () => {
  it('nests narrower tags to any depth', () => {
    const [area] = ontologyRows(
      [
        {
          label: 'Area',
          children: [{ label: 'Platform', children: [{ label: 'infra' }] }],
        },
      ],
      unknown
    );
    const infra = area.children[0].children[0];
    expect([area.label, area.children[0].label, infra.label]).toEqual([
      'Area',
      'Platform',
      'infra',
    ]);
    expect(infra.key).toBe('0.0.0');
  });

  it('colours a tag as written, one with no colour gray, and a branch by the tags under it', () => {
    const [type] = ontologyRows(
      [
        {
          label: 'Type',
          children: [{ label: 'bug', color: 'red' }, { label: 'chore' }],
        },
      ],
      unknown
    );
    expect(type.children.map((row) => row.fills)).toEqual([
      ['#E5484D'],
      [DEFAULT_TAG_COLOR],
    ]);
    expect(type.fills).toEqual(['#E5484D', DEFAULT_TAG_COLOR]);
  });

  it("puts a branch's own colour before those under it", () => {
    const [platform] = ontologyRows(
      [
        {
          label: 'Platform',
          color: 'teal',
          children: [{ label: 'infra', color: 'amber' }],
        },
      ],
      unknown
    );
    expect(platform.fills).toEqual(['#12A594', '#FFB224']);
  });

  it('shows a tag the viewer has by its current name and colour, and opens it', () => {
    const open = vi.fn();
    const known = (tagId: string): KnownTag | undefined =>
      tagId === 'tag-1'
        ? { label: 'Infrastructure', color: '#0091FF', open }
        : undefined;
    const [infra, gone] = ontologyRows(
      [
        { label: 'infra', color: 'amber', tagId: 'tag-1' },
        { label: 'gone', color: 'red', tagId: 'tag-2', description: 'Removed' },
      ],
      known
    );
    expect(infra).toMatchObject({
      label: 'Infrastructure',
      fills: ['#0091FF'],
      onOpen: open,
    });
    expect(gone).toMatchObject({
      label: 'gone',
      fills: ['#E5484D'],
      onOpen: undefined,
      description: 'Removed',
    });
  });

  it('leaves out the path a parent already shows', () => {
    const known = (tagId: string): KnownTag | undefined =>
      tagId === 'tag-bug' ? { label: 'Type/bug', open: vi.fn() } : undefined;
    const [type] = ontologyRows(
      [
        {
          label: 'Type',
          children: [
            { label: 'bug', tagId: 'tag-bug' },
            { label: 'Type/feature' },
            { label: 'Typeface' },
          ],
        },
      ],
      known
    );
    expect(type.children.map((row) => row.label)).toEqual([
      'bug',
      'feature',
      'Typeface',
    ]);
  });
});
