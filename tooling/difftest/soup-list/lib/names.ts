import type { Coverage, Rng } from './rng';

/** Document names may hold at most 200 graphemes (model::document). */
export const MAX_NAME_GRAPHEMES = 200;

const UNICODE = [
  'Café déjà vu',
  'naïve façade',
  '東京の会議メモ',
  '회의록 요약',
  'تقرير الربع',
  'עדכון שבועי',
  'Ünïcödé Ⅻ ①②③',
  '🚀 Launch plan 🎉',
  '👩🏽‍💻 pair notes',
  'zero​width',
  'é combining',
  'Ελληνικά σημειώσεις',
  'русский отчёт',
  '𝔣𝔯𝔞𝔨𝔱𝔲𝔯 math',
];

const PUNCT = [
  'Q3 "plan" (draft)',
  "O'Brien's notes",
  'a/b\\c',
  '100% done?!',
  '<b>not html</b>',
  '#hash & @at',
  '  leading and trailing  ',
  'tab\tinside',
  '[[brackets]] {braces}',
];

export type NameKind = 'plain' | 'long' | 'unicode' | 'punct' | 'tie' | 'case';

/**
 * A name for a synthetic entity, drawn across the odd-value dimensions. `ties`
 * holds earlier names so a tie repeats one exactly.
 */
export function oddName(
  rng: Rng,
  label: string,
  index: number,
  ties: string[],
  coverage: Coverage,
  maxGraphemes = MAX_NAME_GRAPHEMES
): string {
  const kind = rng.weighted<NameKind>([
    [50, 'plain'],
    [8, 'long'],
    [14, 'unicode'],
    [8, 'punct'],
    [14, 'tie'],
    [6, 'case'],
  ]);
  let name: string;
  switch (kind) {
    case 'plain':
      name = `${label} ${String(index).padStart(4, '0')}`;
      break;
    case 'long': {
      const unit = rng.pick(['Long name ', 'Ⓛⓞⓝⓖ ', '長い名前 ', '🧪 ']);
      const graphemes = [...new Intl.Segmenter().segment(unit)].length;
      name = unit.repeat(Math.ceil(maxGraphemes / graphemes));
      const segs = [...new Intl.Segmenter().segment(name)].map((s) => s.segment);
      name = segs.slice(0, maxGraphemes - rng.int(0, 3)).join('');
      break;
    }
    case 'unicode':
      name = `${rng.pick(UNICODE)} ${index}`;
      break;
    case 'punct':
      name = `${rng.pick(PUNCT)} ${index}`;
      break;
    case 'tie':
      name = ties.length ? rng.pick(ties) : `${label} tie`;
      break;
    case 'case': {
      const base = ties.length ? rng.pick(ties) : `${label} Case`;
      name = rng.bool() ? base.toUpperCase() : base.toLowerCase();
      break;
    }
  }
  coverage.hit('name', kind);
  if (kind !== 'tie') ties.push(name);
  if (ties.length > 40) ties.shift();
  return name;
}
