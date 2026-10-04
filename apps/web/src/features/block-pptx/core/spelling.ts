/**
 * Spell checking, as PowerPoint's proofing does it: words are checked
 * against a Hunspell dictionary (expanded from its affix rules into a word
 * set), words with digits, ALL-CAPS words, web addresses, and e-mail
 * addresses are skipped, and suggestions come from small edits ranked by a
 * keyboard- and vowel-aware edit distance.
 *
 * Text positions are code points within a paragraph, as the engine counts
 * them (a line break, `\u000b`, is one character).
 */

/** A word in a paragraph: code point offsets `start..end`. */
export interface WordToken {
  word: string;
  start: number;
  end: number;
}

interface Affix {
  prefix: boolean;
  /** Combines with affixes of the other kind. */
  cross: boolean;
  strip: string;
  add: string;
  condition: RegExp;
}

/** The parts of a Hunspell `.aff` file spell checking uses. */
export interface AffixRules {
  affixes: Map<string, Affix[]>;
  /** Flag of words accepted but never suggested (taboo words). */
  noSuggest?: string;
  /** Common misspelling patterns (`REP from to`; `_` is a space). */
  replacements: [string, string][];
}

/** A dictionary expanded into the words it accepts. */
export interface Lexicon {
  words: Set<string>;
  /** Accepted but never suggested. */
  hidden: Set<string>;
  replacements: [string, string][];
}

/** Parses the `PFX`/`SFX`, `NOSUGGEST`, and `REP` rules of an affix file. */
export function parseAffixes(text: string): AffixRules {
  const affixes = new Map<string, Affix[]>();
  const cross = new Map<string, boolean>();
  const replacements: [string, string][] = [];
  let noSuggest: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split('#')[0].trim().split(/\s+/);
    const [kind, flag] = parts;
    if (kind === 'NOSUGGEST') noSuggest = flag;
    else if (kind === 'REP' && parts.length >= 3)
      replacements.push([parts[1], parts[2].replace(/_/g, ' ')]);
    else if ((kind === 'PFX' || kind === 'SFX') && flag) {
      // The header line: `SFX D Y 4`.
      if (parts.length === 4 && /^[YN]$/.test(parts[2])) {
        cross.set(flag, parts[2] === 'Y');
        continue;
      }
      if (parts.length < 4) continue;
      const prefix = kind === 'PFX';
      const strip = parts[2] === '0' ? '' : parts[2];
      const add = parts[3] === '0' ? '' : parts[3].split('/')[0];
      const condition = parts[4] ?? '.';
      const list = affixes.get(flag) ?? [];
      list.push({
        prefix,
        cross: cross.get(flag) ?? false,
        strip,
        add,
        condition: new RegExp(prefix ? `^${condition}` : `${condition}$`, 'u'),
      });
      affixes.set(flag, list);
    }
  }
  return { affixes, noSuggest, replacements };
}

/** The forms an affix makes of `stem`, or none when it does not apply. */
function applyAffix(stem: string, affix: Affix): string | undefined {
  if (!affix.condition.test(stem)) return undefined;
  if (affix.prefix) {
    if (affix.strip && !stem.startsWith(affix.strip)) return undefined;
    return affix.add + stem.slice(affix.strip.length);
  }
  if (affix.strip && !stem.endsWith(affix.strip)) return undefined;
  return stem.slice(0, stem.length - affix.strip.length) + affix.add;
}

/**
 * Expands a Hunspell `.dic` file (`word/FLAGS` per line after the count)
 * with `rules` into the words it accepts. Entries with digits (ordinals
 * built by compound rules) are left out: words with digits are not checked.
 */
export function expandDictionary(dic: string, rules: AffixRules): Lexicon {
  const words = new Set<string>();
  const hidden = new Set<string>();
  const lines = dic.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const slash = line.indexOf('/');
    const stem = slash < 0 ? line : line.slice(0, slash);
    if (/\d/.test(stem)) continue;
    const flags = slash < 0 ? '' : line.slice(slash + 1).split(/\s/)[0];
    const target =
      rules.noSuggest && flags.includes(rules.noSuggest) ? hidden : words;
    target.add(stem);
    const suffixed: string[] = [];
    for (const flag of flags) {
      for (const affix of rules.affixes.get(flag) ?? []) {
        if (affix.prefix) continue;
        const form = applyAffix(stem, affix);
        if (form === undefined) continue;
        target.add(form);
        if (affix.cross) suffixed.push(form);
      }
    }
    for (const flag of flags) {
      for (const affix of rules.affixes.get(flag) ?? []) {
        if (!affix.prefix) continue;
        for (const base of [stem, ...(affix.cross ? suffixed : [])]) {
          const form = applyAffix(base, affix);
          if (form !== undefined) target.add(form);
        }
      }
    }
  }
  for (const w of hidden) words.delete(w);
  return { words, hidden, replacements: rules.replacements };
}

// ---- tokens -----------------------------------------------------------------

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const WHITESPACE_CHUNK = /\S+/gu;

/** A web address, file-like name (`deck.pptx`), or e-mail address. */
function isAddress(chunk: string): boolean {
  const c = chunk.replace(/^[("'“‘[<]+|[)"'”’\]>.,;:!?]+$/gu, '');
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(c) ||
    /^www\./i.test(c) ||
    /^[^\s@]+@[^\s@]+$/.test(c) ||
    /^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)+(\/\S*)?$/u.test(c)
  );
}

/** Converts UTF-16 indices of `text` to code point offsets. */
function codePointOffsets(text: string): number[] {
  const out = new Array<number>(text.length + 1);
  let cp = 0;
  for (let i = 0; i < text.length; i++) {
    out[i] = cp;
    const code = text.charCodeAt(i);
    // The low half of a surrogate pair shares its high half's offset.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      out[i + 1] = cp;
      i++;
    }
    cp++;
  }
  out[text.length] = cp;
  return out;
}

/**
 * The words of a paragraph. Hyphenated words are split into their parts;
 * web and e-mail addresses are skipped.
 */
export function tokenize(text: string): WordToken[] {
  const offsets = codePointOffsets(text);
  const out: WordToken[] = [];
  for (const chunk of text.matchAll(WHITESPACE_CHUNK)) {
    if (isAddress(chunk[0])) continue;
    const base = chunk.index ?? 0;
    for (const m of chunk[0].matchAll(WORD)) {
      const from = base + (m.index ?? 0);
      out.push({
        word: m[0],
        start: offsets[from],
        end: offsets[from + m[0].length],
      });
    }
  }
  return out;
}

/** Words PowerPoint does not check by default: with digits, or in UPPERCASE. */
export function isIgnoredByDefault(word: string): boolean {
  if (/\p{N}/u.test(word)) return true;
  const letters = word.replace(/[^\p{L}]/gu, '');
  return (
    letters.length > 1 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  );
}

// ---- checking and suggestions ------------------------------------------------

const normalize = (word: string) => word.replace(/’/g, "'");
const capitalize = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1);
const isTitle = (word: string) =>
  word.length > 0 && word === capitalize(word.toLowerCase());
const isUpper = (word: string) =>
  word === word.toUpperCase() && word !== word.toLowerCase();

export interface Speller {
  /** Whether the dictionary accepts `word` (in a sentence-start or all-caps form too). */
  correct: (word: string) => boolean;
  /** Up to `limit` corrections, best first, in the case of `word`. */
  suggest: (word: string, limit?: number) => string[];
}

const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const VOWELS = new Set('aeiouy');
const ALPHABET = "abcdefghijklmnopqrstuvwxyz'";

function keyPosition(c: string): [number, number] | undefined {
  for (let row = 0; row < KEYBOARD.length; row++) {
    const col = KEYBOARD[row].indexOf(c);
    if (col >= 0) return [row, col + row * 0.5];
  }
  return undefined;
}

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  if (VOWELS.has(a) && VOWELS.has(b)) return 0.7;
  const pa = keyPosition(a);
  const pb = keyPosition(b);
  if (pa && pb && Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1)
    return 0.7;
  return 1;
}

/**
 * Edit distance where likely typing slips cost less: neighboring keys,
 * vowel swaps, swapped letters, and doubled or undoubled letters.
 */
export function typoDistance(from: string, to: string): number {
  const a = [...from];
  const b = [...to];
  // Inserting or deleting a letter next to the same letter costs half.
  const indels = (s: string[]) =>
    s.map((c, i) => (c === s[i - 1] || c === s[i + 1] ? 0.5 : 1));
  const da = indels(a);
  const db = indels(b);
  // Three rolling rows: i - 2 (swaps), i - 1, and i.
  let older = new Float64Array(b.length + 1);
  let prev = new Float64Array(b.length + 1);
  let row = new Float64Array(b.length + 1);
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + db[j - 1];
  for (let i = 1; i <= a.length; i++) {
    row[0] = prev[0] + da[i - 1];
    for (let j = 1; j <= b.length; j++) {
      let best = Math.min(
        prev[j] + da[i - 1],
        row[j - 1] + db[j - 1],
        prev[j - 1] + substitutionCost(a[i - 1], b[j - 1])
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1] &&
        a[i - 1] !== a[i - 2]
      )
        best = Math.min(best, older[j - 2] + 0.6);
      row[j] = best;
    }
    [older, prev, row] = [prev, row, older];
  }
  return prev[b.length];
}

/** Every string one deletion, swap, replacement, or insertion away. */
function edits(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i <= word.length; i++) {
    const head = word.slice(0, i);
    const tail = word.slice(i);
    if (tail) out.push(head + tail.slice(1));
    if (tail.length > 1) out.push(head + tail[1] + tail[0] + tail.slice(2));
    for (const c of ALPHABET) {
      if (tail) out.push(head + c + tail.slice(1));
      out.push(head + c + tail);
    }
  }
  return out;
}

/** Restores the case of the misspelled word on a suggestion. */
export function matchCase(original: string, suggestion: string): string {
  if (isUpper(original) && original.length > 1) return suggestion.toUpperCase();
  if (isTitle(original) || /^\p{Lu}/u.test(original))
    return capitalize(suggestion);
  return suggestion;
}

/** A speller over an expanded dictionary. */
export function createSpeller(lexicon: Lexicon): Speller {
  const { words, hidden } = lexicon;
  const has = (w: string) => words.has(w) || hidden.has(w);
  const known = new Map<string, boolean>();
  /** Words by their first letter (lowercase), built on the first suggestion. */
  let byInitial: Map<string, string[]> | undefined;
  const initialIndex = () => {
    if (byInitial) return byInitial;
    byInitial = new Map();
    for (const w of words) {
      const key = w.charAt(0).toLowerCase();
      const list = byInitial.get(key);
      if (list) list.push(w);
      else byInitial.set(key, [w]);
    }
    return byInitial;
  };

  function check(raw: string): boolean {
    const w = normalize(raw);
    if (has(w)) return true;
    const lower = w.toLowerCase();
    if (isTitle(w) && has(lower)) return true;
    if (isUpper(w) && (has(lower) || has(capitalize(lower)))) return true;
    // Possessives of accepted words ("Acme's", "students'").
    if (/'s$/i.test(w) && w.length > 2) return check(w.slice(0, -2));
    if (w.endsWith("'") && w.length > 1) return check(w.slice(0, -1));
    return false;
  }

  function correct(word: string): boolean {
    const cached = known.get(word);
    if (cached !== undefined) return cached;
    const result = check(word);
    known.set(word, result);
    return result;
  }

  /** The dictionary spelling of a candidate (proper nouns keep their capital). */
  function entry(candidate: string): string | undefined {
    if (words.has(candidate)) return candidate;
    const title = capitalize(candidate);
    if (words.has(title)) return title;
    return undefined;
  }

  function suggest(word: string, limit = 5): string[] {
    const w = normalize(word);
    const lower = w.toLowerCase();
    const scores = new Map<string, number>();
    const offer = (suggestion: string, score: number) =>
      scores.set(suggestion, Math.min(scores.get(suggestion) ?? score, score));
    const consider = (candidate: string, bonus = 0) => {
      const found = entry(candidate);
      if (!found || found.toLowerCase() === lower) return;
      const properNoun = found !== found.toLowerCase();
      const score =
        typoDistance(lower, found.toLowerCase()) +
        (properNoun && !/^\p{Lu}/u.test(w) ? 0.4 : 0) +
        (found[0]?.toLowerCase() !== lower[0] ? 0.3 : 0) -
        bonus;
      offer(found, score);
    };
    for (const [from, to] of lexicon.replacements) {
      let at = lower.indexOf(from);
      while (at >= 0) {
        const replaced =
          lower.slice(0, at) + to + lower.slice(at + from.length);
        if (replaced.includes(' ')) {
          const parts = replaced.split(' ');
          if (parts.every((p) => p && correct(p))) offer(replaced, 0.9);
        } else consider(replaced, 0.2);
        at = lower.indexOf(from, at + 1);
      }
    }
    const first = edits(lower);
    for (const e of first) consider(e);
    // Two words run together ("thankyou" → "thank you").
    for (let i = 1; i < lower.length; i++) {
      const a = lower.slice(0, i);
      const b = lower.slice(i);
      const short = (part: string) => part.length < 3 && part !== 'a';
      if (!short(a) && !short(b) && entry(a) && entry(b))
        offer(`${a} ${b}`, 1.4);
    }
    // Further away (two or more slips) only when one edit finds next to
    // nothing: words with the same first letter and a similar length.
    if (scores.size < 2) {
      const n = [...lower].length;
      for (const candidate of initialIndex().get(lower.charAt(0)) ?? []) {
        if (Math.abs(candidate.length - n) > 2) continue;
        if (typoDistance(lower, candidate.toLowerCase()) <= 2.2)
          consider(candidate);
      }
    }
    return [...scores.entries()]
      .sort(
        ([a, sa], [b, sb]) =>
          sa - sb ||
          Math.abs(a.length - lower.length) -
            Math.abs(b.length - lower.length) ||
          a.localeCompare(b)
      )
      .slice(0, limit)
      .map(([s]) => matchCase(w, s));
  }

  return { correct, suggest };
}

/** Words a person told the speller to accept (Add to Dictionary, Ignore All). */
export interface AcceptedWords {
  has: (word: string) => boolean;
}

/** The misspelled words of a paragraph. */
export function misspelledWords(
  text: string,
  speller: Speller,
  accepted?: AcceptedWords
): WordToken[] {
  return tokenize(text).filter((t) => {
    if (isIgnoredByDefault(t.word)) return false;
    // A word joined to another by an apostrophe at its edge ("'quoted'").
    const word = t.word.replace(/^['’]+|['’]+$/g, '');
    if (!word) return false;
    if (accepted?.has(word) || accepted?.has(word.toLowerCase())) return false;
    return !speller.correct(word);
  });
}
