/**
 * Review ▸ Spelling (F7): walks the deck's misspellings from the current
 * slide on, showing each word selected on its slide, with Change, Change
 * All, Ignore Once, Ignore All, and Add, until "Spell check complete".
 */

import { createSignal } from 'solid-js';
import {
  deckMisspellings,
  type Misspelling,
  misspellingKey,
  slideTexts,
  sourceKey,
} from '../core/spelling-scan';
import type { PresentationSession } from './create-presentation-session';
import type { SpellCheck } from './create-spell-check';

export interface SpellingPaneOptions {
  session: PresentationSession;
  spell: SpellCheck;
  /** Shows a misspelling: its slide, with the word selected. */
  showWord: (m: Misspelling) => Promise<void>;
}

/** Where an occurrence is in the walk: slide (from the start), body, paragraph, offset. */
function rank(
  m: Misspelling,
  start: number,
  count: number,
  order: (m: Misspelling) => number
) {
  return [
    (m.slideIndex - start + count) % count,
    order(m),
    m.paragraph,
    m.start,
  ];
}

const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export function createSpellingPane(options: SpellingPaneOptions) {
  const { session, spell } = options;
  const [open, setOpen] = createSignal(false);
  const [current, setCurrent] = createSignal<Misspelling | null>(null);
  const [suggestions, setSuggestions] = createSignal<string[]>([]);
  const [choice, setChoice] = createSignal<string>();
  const [complete, setComplete] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let start = 0;
  const ignoredOnce = new Set<string>();

  /** The order of a misspelling's text body on its slide. */
  const bodyOrder = (m: Misspelling) => {
    const slide = session.outline()?.slides[m.slideIndex];
    if (!slide) return 0;
    const key = sourceKey(m.shape, m.cell);
    return slideTexts(slide).findIndex(
      (s) => sourceKey(s.shape, s.cell) === key
    );
  };

  const remaining = () => {
    const deck = session.outline();
    const speller = spell.speller();
    if (!deck || !speller || deck.slides.length === 0) return [];
    return deckMisspellings(deck, start, speller, spell.accepted()).filter(
      (m) => !ignoredOnce.has(misspellingKey(m))
    );
  };

  /** Moves to the first misspelling at or after `from` (wrapping), or completes. */
  async function advance(from?: Misspelling) {
    const items = remaining();
    if (items.length === 0) {
      setCurrent(null);
      setSuggestions([]);
      setComplete(true);
      return;
    }
    const count = session.outline()?.slides.length ?? 1;
    const after = from && rank(from, start, count, bodyOrder);
    const next =
      (after &&
        items.find(
          (m) => compare(rank(m, start, count, bodyOrder), after) >= 0
        )) ??
      items[0];
    const list = spell.suggest(next.word);
    setCurrent(next);
    setSuggestions(list);
    setChoice(list[0]);
    setComplete(false);
    await options.showWord(next);
  }

  /** Runs a step, one at a time (buttons pressed quickly wait their turn). */
  async function step(action: () => Promise<void>) {
    if (busy()) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    current,
    suggestions,
    choice,
    setChoice,
    complete,
    busy,
    /** Opens the pane and finds the first misspelling from the current slide. */
    start: () =>
      step(async () => {
        await spell.ready();
        start = session.slideIndex();
        ignoredOnce.clear();
        setOpen(true);
        await advance();
      }),
    close: () => {
      setOpen(false);
      setCurrent(null);
      setComplete(false);
    },
    change: () =>
      step(async () => {
        const m = current();
        const word = choice();
        if (!m || !word) return;
        // Text edited meanwhile may have moved or fixed the word.
        const key = misspellingKey(m);
        const still = remaining().find((o) => misspellingKey(o) === key);
        if (still) await spell.replace([still], word);
        await advance(m);
      }),
    changeAll: () =>
      step(async () => {
        const m = current();
        const word = choice();
        const deck = session.outline();
        const speller = spell.speller();
        if (!m || !word || !deck || !speller) return;
        // Every occurrence, whatever its case ("Recieve", "recieve").
        const misspelled = m.word.toLowerCase();
        const all = deckMisspellings(deck, 0, speller, spell.accepted()).filter(
          (o) => o.word.toLowerCase() === misspelled
        );
        await spell.replace(all, word);
        await advance(m);
      }),
    ignoreOnce: () =>
      step(async () => {
        const m = current();
        if (!m) return;
        ignoredOnce.add(misspellingKey(m));
        await advance(m);
      }),
    ignoreAll: () =>
      step(async () => {
        const m = current();
        if (!m) return;
        spell.ignoreAll(m.word);
        await advance(m);
      }),
    add: () =>
      step(async () => {
        const m = current();
        if (!m) return;
        spell.addToDictionary(m.word);
        await advance(m);
      }),
  };
}

export type SpellingPaneState = ReturnType<typeof createSpellingPane>;
