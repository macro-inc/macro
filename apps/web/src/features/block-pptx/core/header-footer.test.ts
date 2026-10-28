import type { DeckOutline, SlideOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  DATE_FORMATS,
  formatDate,
  headerFooterPatch,
  hiddenOnTitleSlides,
  initialForm,
} from './header-footer';

const slide = (
  id: number,
  layout: string,
  headerFooter?: SlideOutline['headerFooter']
): SlideOutline => ({
  id,
  index: id,
  layout,
  hidden: false,
  shapes: [],
  headerFooter,
});

const deck = (slides: SlideOutline[]): DeckOutline => ({
  width: 960,
  height: 540,
  slides,
  layouts: [
    { part: 'l1', name: 'Title Slide', kind: 'title', master: 'm' },
    { part: 'l2', name: 'Title and Content', kind: 'obj', master: 'm' },
  ],
  themeColors: [],
  tableStyles: [],
});

const shown = {
  slideNumber: true,
  date: false,
  footer: true,
  footerText: 'Q3',
};

describe('date formats', () => {
  it('shows each automatic format as PowerPoint writes it', () => {
    // Sunday, 4 October 2026, 3:05:09 PM local time.
    const now = new Date(2026, 9, 4, 15, 5, 9);
    expect(DATE_FORMATS.map((f) => formatDate(f, now))).toEqual([
      '10/4/2026',
      'Sunday, October 4, 2026',
      '4 October 2026',
      'October 4, 2026',
      '4-Oct-26',
      'October 26',
      'Oct-26',
      '10/4/2026 3:05 PM',
      '10/4/2026 3:05:09 PM',
      '15:05',
      '15:05:09',
      '3:05 PM',
      '3:05:09 PM',
    ]);
  });

  it('writes midnight and noon on a 12-hour clock', () => {
    expect(formatDate('datetime12', new Date(2026, 0, 2, 0, 7))).toBe(
      '12:07 AM'
    );
    expect(formatDate('datetime12', new Date(2026, 0, 2, 12, 0))).toBe(
      '12:00 PM'
    );
    expect(formatDate('datetime5', new Date(2009, 0, 2))).toBe('2-Jan-09');
  });
});

describe('header and footer form', () => {
  const now = new Date(2026, 9, 4);

  it('starts from what the slide shows', () => {
    const d = deck([
      slide(1, 'Title Slide', {
        ...shown,
        date: true,
        dateText: 'Q3 2026',
      }),
    ]);
    expect(initialForm(d, d.slides[0], now)).toEqual({
      date: true,
      dateMode: 'fixed',
      dateFormat: 'datetime1',
      dateText: 'Q3 2026',
      slideNumber: true,
      footer: true,
      footerText: 'Q3',
      notOnTitle: false,
    });
  });

  it('offers today for a new fixed date and keeps an automatic format', () => {
    const d = deck([
      slide(1, 'Title and Content', {
        ...shown,
        date: true,
        dateFormat: 'datetime4',
      }),
    ]);
    const form = initialForm(d, d.slides[0], now);
    expect(form.dateMode).toBe('auto');
    expect(form.dateFormat).toBe('datetime4');
    expect(form.dateText).toBe('10/4/2026');
    expect(initialForm(d, undefined, now).date).toBe(false);
  });

  it('reads "Don\'t show on title slide" from the title slides', () => {
    const hidden = deck([
      slide(1, 'Title Slide'),
      slide(2, 'Title and Content', shown),
    ]);
    expect(hiddenOnTitleSlides(hidden)).toBe(true);
    // A title slide that hides them starts from a slide that shows them.
    expect(initialForm(hidden, hidden.slides[0], now)).toMatchObject({
      slideNumber: true,
      footerText: 'Q3',
      notOnTitle: true,
    });
    const none = deck([slide(1, 'Title Slide'), slide(2, 'Title and Content')]);
    expect(hiddenOnTitleSlides(none)).toBe(false);
    const all = deck([
      slide(1, 'Title Slide', shown),
      slide(2, 'Title and Content', shown),
    ]);
    expect(hiddenOnTitleSlides(all)).toBe(false);
  });

  it('builds the change of Apply and Apply to All', () => {
    const form = {
      date: true,
      dateMode: 'auto' as const,
      dateFormat: 'datetime2' as const,
      dateText: '10/4/2026',
      slideNumber: true,
      footer: false,
      footerText: 'ignored',
      notOnTitle: true,
    };
    expect(headerFooterPatch(form)).toEqual({
      slideNumber: true,
      date: true,
      dateText: '',
      dateFormat: 'datetime2',
      footer: false,
      notOnTitle: true,
    });
    expect(
      headerFooterPatch(
        { ...form, dateMode: 'fixed', footer: true, footerText: 'Hi' },
        [7]
      )
    ).toEqual({
      slides: [7],
      slideNumber: true,
      date: true,
      dateText: '10/4/2026',
      footer: true,
      footerText: 'Hi',
      notOnTitle: true,
    });
    // An empty fixed date keeps what the date shows.
    expect(
      headerFooterPatch({ ...form, dateMode: 'fixed', dateText: '' })
    ).not.toHaveProperty('dateText');
  });
});
