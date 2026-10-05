/**
 * Insert ▸ Header & Footer: the automatic date formats (shown by example,
 * as PowerPoint lists them), the dialog's initial state from a slide, and the
 * operation the dialog applies.
 */

import type {
  DateFormat,
  DeckOutline,
  HeaderFooterOutline,
  HeaderFooterPatch,
  SlideOutline,
} from '@core/pptx-engine/types';

/** The automatic date formats, in the order of PowerPoint's list. */
export const DATE_FORMATS: readonly DateFormat[] = [
  'datetime1',
  'datetime2',
  'datetime3',
  'datetime4',
  'datetime5',
  'datetime6',
  'datetime7',
  'datetime8',
  'datetime9',
  'datetime10',
  'datetime11',
  'datetime12',
  'datetime13',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function isDateFormat(value: string | undefined): value is DateFormat {
  return DATE_FORMATS.includes(value as DateFormat);
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The text an automatic date in `format` shows at `now` (local time, US
 * English, as PowerPoint and the engine write the fields).
 */
export function formatDate(format: DateFormat, now: Date): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const yy = two(y % 100);
  const month = MONTHS[now.getMonth()];
  const short = month.slice(0, 3);
  const hours = now.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const meridiem = hours < 12 ? 'AM' : 'PM';
  const min = two(now.getMinutes());
  const sec = two(now.getSeconds());
  const formats: Record<DateFormat, string> = {
    datetime1: `${m}/${d}/${y}`,
    datetime2: `${WEEKDAYS[now.getDay()]}, ${month} ${d}, ${y}`,
    datetime3: `${d} ${month} ${y}`,
    datetime4: `${month} ${d}, ${y}`,
    datetime5: `${d}-${short}-${yy}`,
    datetime6: `${month} ${yy}`,
    datetime7: `${short}-${yy}`,
    datetime8: `${m}/${d}/${y} ${h12}:${min} ${meridiem}`,
    datetime9: `${m}/${d}/${y} ${h12}:${min}:${sec} ${meridiem}`,
    datetime10: `${hours}:${min}`,
    datetime11: `${hours}:${min}:${sec}`,
    datetime12: `${h12}:${min} ${meridiem}`,
    datetime13: `${h12}:${min}:${sec} ${meridiem}`,
  };
  return formats[format];
}

/** What the Header & Footer dialog holds. */
export interface HeaderFooterForm {
  date: boolean;
  /** "Update automatically" or "Fixed". */
  dateMode: 'auto' | 'fixed';
  dateFormat: DateFormat;
  /** The fixed date's text. */
  dateText: string;
  slideNumber: boolean;
  footer: boolean;
  footerText: string;
  notOnTitle: boolean;
}

/** Whether a slide uses a Title Slide layout. */
export function isTitleSlide(deck: DeckOutline, slide: SlideOutline): boolean {
  return deck.layouts.some(
    (l) => l.name === slide.layout && l.kind === 'title'
  );
}

const showsAnything = (slide: SlideOutline) => {
  const hf = slide.headerFooter;
  return !!hf && (hf.slideNumber || hf.date || hf.footer);
};

/**
 * "Don't show on title slide" as the deck reads: its title slides show
 * nothing while another slide shows something.
 */
export function hiddenOnTitleSlides(deck: DeckOutline): boolean {
  const titles = deck.slides.filter((s) => isTitleSlide(deck, s));
  if (titles.length === 0 || titles.some(showsAnything)) return false;
  return deck.slides.some((s) => !isTitleSlide(deck, s) && showsAnything(s));
}

/**
 * The dialog's starting state: what `slide` shows (the first slide that shows
 * anything when `slide` is a title slide hiding them), with today's date for
 * a new fixed date.
 */
export function initialForm(
  deck: DeckOutline,
  slide: SlideOutline | undefined,
  now: Date
): HeaderFooterForm {
  const notOnTitle = hiddenOnTitleSlides(deck);
  const source =
    slide && notOnTitle && isTitleSlide(deck, slide)
      ? (deck.slides.find(showsAnything) ?? slide)
      : slide;
  const hf: HeaderFooterOutline = source?.headerFooter ?? {
    slideNumber: false,
    date: false,
    footer: false,
  };
  return {
    ...dateFields(hf, now),
    slideNumber: hf.slideNumber,
    footer: hf.footer,
    footerText: hf.footerText ?? '',
    notOnTitle,
  };
}

/** The date part of the form: fixed text, or an automatic format. */
function dateFields(
  hf: HeaderFooterOutline,
  now: Date
): Pick<HeaderFooterForm, 'date' | 'dateMode' | 'dateFormat' | 'dateText'> {
  const fixed = hf.date && hf.dateText !== undefined;
  return {
    date: hf.date,
    dateMode: fixed ? 'fixed' : 'auto',
    dateFormat: isDateFormat(hf.dateFormat) ? hf.dateFormat : 'datetime1',
    dateText:
      fixed && hf.dateText !== undefined
        ? hf.dateText
        : formatDate('datetime1', now),
  };
}

/**
 * What Apply (`slides`) or Apply to All (no `slides`) changes. A fixed date
 * left empty keeps what each slide's date shows.
 */
export function headerFooterPatch(
  form: HeaderFooterForm,
  slides?: number[]
): HeaderFooterPatch {
  const date =
    form.date && form.dateMode === 'auto'
      ? { dateText: '', dateFormat: form.dateFormat }
      : form.date && form.dateText !== ''
        ? { dateText: form.dateText }
        : {};
  return {
    ...(slides ? { slides } : {}),
    slideNumber: form.slideNumber,
    date: form.date,
    ...date,
    footer: form.footer,
    ...(form.footer ? { footerText: form.footerText } : {}),
    notOnTitle: form.notOnTitle,
  };
}
