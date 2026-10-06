import type {
  DeckOutline,
  LinkRegion,
  RunStyle,
  TextLayoutInfo,
} from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  emailLink,
  linkAction,
  linkKind,
  linkLabel,
  linkSpan,
  normalizeAddress,
  parseEmail,
  regionAt,
  safeUrl,
} from './links';

const deck = {
  slides: [
    {
      id: 256,
      shapes: [
        {
          id: 2,
          placeholder: 'title',
          paragraphs: [{ text: 'Welcome', level: 0 }],
        },
      ],
    },
    { id: 300, shapes: [] },
    {
      id: 257,
      shapes: [
        { id: 3, paragraphs: [{ text: ' Results\u000bQ3 ', level: 0 }] },
      ],
    },
  ],
} as unknown as DeckOutline;

describe('link strings', () => {
  it('normalizes typed addresses', () => {
    expect(normalizeAddress('macro.com')).toBe('https://macro.com');
    expect(normalizeAddress(' http://a.b/c ')).toBe('http://a.b/c');
    expect(normalizeAddress('team@macro.com')).toBe('mailto:team@macro.com');
    expect(normalizeAddress('#nextslide')).toBe('#nextslide');
    expect(normalizeAddress('')).toBe('');
  });

  it('builds and parses email links', () => {
    const link = emailLink('team@macro.com', 'Q3 & beyond');
    expect(link).toBe('mailto:team@macro.com?subject=Q3%20%26%20beyond');
    expect(parseEmail(link)).toEqual({
      address: 'team@macro.com',
      subject: 'Q3 & beyond',
    });
    expect(emailLink('mailto:a@b.co', ' ')).toBe('mailto:a@b.co');
    expect(linkKind(link)).toBe('email');
    expect(linkKind('#slide=257')).toBe('place');
    expect(linkKind('https://macro.com')).toBe('web');
  });

  it('labels links like PowerPoint lists them', () => {
    expect(linkLabel('#slide=257', deck)).toBe('Slide 3: Results Q3');
    expect(linkLabel('#slide=300', deck)).toBe('Slide 2');
    expect(linkLabel('#slide=999', deck)).toBe('Another slide');
    expect(linkLabel('#previousslide')).toBe('Previous Slide');
    expect(linkLabel('#endshow')).toBe('End Show');
    expect(linkLabel('mailto:a@b.co?subject=x')).toBe('a@b.co');
  });

  it('only opens safe addresses', () => {
    expect(safeUrl('https://macro.com')).toBe(true);
    expect(safeUrl('mailto:a@b.co')).toBe(true);
    expect(safeUrl('javascript:alert(1)')).toBe(false);
    expect(safeUrl('file:///etc/passwd')).toBe(false);
  });
});

describe('following links in a show', () => {
  it('resolves slide links and jumps', () => {
    expect(linkAction('#slide=257', deck, 0)).toEqual({
      kind: 'slide',
      index: 2,
    });
    expect(linkAction('#nextslide', deck, 1)).toEqual({
      kind: 'slide',
      index: 2,
    });
    expect(linkAction('#nextslide', deck, 2)).toEqual({ kind: 'end' });
    expect(linkAction('#previousslide', deck, 0)).toEqual({ kind: 'none' });
    expect(linkAction('#lastslide', deck, 0)).toEqual({
      kind: 'slide',
      index: 2,
    });
    expect(linkAction('#lastslideviewed', deck, 2, 0)).toEqual({
      kind: 'slide',
      index: 0,
    });
    expect(linkAction('#endshow', deck, 1)).toEqual({ kind: 'end' });
    expect(linkAction('#slide=999', deck, 0)).toEqual({ kind: 'none' });
    expect(linkAction('https://macro.com', deck, 0)).toEqual({
      kind: 'open',
      url: 'https://macro.com',
    });
    expect(linkAction('javascript:void 0', deck, 0)).toEqual({
      kind: 'none',
    });
  });

  it('hit tests rotated regions, earlier first', () => {
    // A diamond (a square turned 45°) around (10, 10), then a box over it.
    const diamond: LinkRegion = {
      shape: 1,
      link: '#nextslide',
      quad: [10, 0, 20, 10, 10, 20, 0, 10],
    };
    const box: LinkRegion = {
      shape: 2,
      link: 'https://macro.com',
      quad: [0, 0, 20, 0, 20, 20, 0, 20],
    };
    expect(regionAt([diamond, box], 10, 10)?.shape).toBe(1);
    expect(regionAt([diamond, box], 1, 1)?.shape).toBe(2);
    expect(regionAt([diamond, box], 30, 30)).toBeUndefined();
  });
});

describe('links in text', () => {
  const run = (start: number, end: number, link?: string): RunStyle => ({
    start,
    end,
    bold: false,
    italic: false,
    underline: !!link,
    strike: false,
    size: 18,
    font: 'Calibri',
    link,
    linkTip: link ? 'Tip' : undefined,
  });
  const layout = {
    styles: [
      {
        align: 'left',
        level: 0,
        bullet: false,
        // "See the results here": "the results" is linked in two runs.
        runs: [
          run(0, 4),
          run(4, 7, '#slide=257'),
          run(7, 15, '#slide=257'),
          run(15, 20),
        ],
        end: run(20, 20),
      },
    ],
  } as unknown as TextLayoutInfo;

  it('finds the whole linked stretch around the caret', () => {
    const span = linkSpan(layout, { paragraph: 0, offset: 9 });
    expect(span).toEqual({
      start: { paragraph: 0, offset: 4 },
      end: { paragraph: 0, offset: 15 },
      link: '#slide=257',
      tip: 'Tip',
    });
    // At either edge of the link too.
    expect(linkSpan(layout, { paragraph: 0, offset: 4 })?.link).toBe(
      '#slide=257'
    );
    expect(linkSpan(layout, { paragraph: 0, offset: 15 })?.link).toBe(
      '#slide=257'
    );
    expect(linkSpan(layout, { paragraph: 0, offset: 2 })).toBeUndefined();
  });
});
