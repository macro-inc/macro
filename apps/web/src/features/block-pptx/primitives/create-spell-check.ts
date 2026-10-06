/**
 * Proofing for the editor: red wavy underlines under misspelled words on
 * the slide being edited, the right-click corrections, and the words this
 * browser was told to accept (Add to Dictionary, Ignore All).
 *
 * The en-US dictionary (~550 KB, ~190 KB compressed) is a separate chunk
 * loaded a moment after the editor opens, or on the first spelling command,
 * so it never delays opening a presentation.
 */

import type { CellRef, TextLayoutInfo } from '@core/pptx-engine/types';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import type { Point } from '../core/geometry';
import {
  createSpeller,
  expandDictionary,
  matchCase,
  misspelledWords,
  parseAffixes,
  type Speller,
} from '../core/spelling';
import {
  inQuad,
  type Misspelling,
  replaceOps,
  slideTexts,
  sourceKey,
  sourceMisspellings,
  type WordGeometry,
  wordGeometry,
} from '../core/spelling-scan';
import type { PresentationSession } from './create-presentation-session';
import type { SlideEditor } from './create-slide-editor';

/** A misspelling on the slide on screen, with where it is drawn. */
export type Squiggle = Misspelling & WordGeometry;

let loading: Promise<Speller> | undefined;

/** The en-US speller, loaded once per page. */
export function loadSpeller(): Promise<Speller> {
  loading ??= (async () => {
    const [aff, dic] = await Promise.all([
      import('../core/dictionary/en_US.aff?raw'),
      import('../core/dictionary/en_US.dic?raw'),
    ]);
    return createSpeller(
      expandDictionary(dic.default, parseAffixes(aff.default))
    );
  })();
  // A failed load (offline) may be retried.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}

const DICTIONARY_KEY = 'pptx-spelling-dictionary';
const IGNORE_KEY = 'pptx-spelling-ignore-all';

function readList(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((w): w is string => typeof w === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeList(key: string, words: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(words));
  } catch {
    // Storage may be unavailable; the words count for this session.
  }
}

/** Words added to the dictionary or ignored everywhere, kept in this browser. */
export function createSpellingPreferences() {
  const [dictionary, setDictionary] = createSignal(readList(DICTIONARY_KEY));
  const [ignored, setIgnored] = createSignal(readList(IGNORE_KEY));
  const accepted = () => new Set([...dictionary(), ...ignored()]);
  const add = (word: string) => {
    const next = [...new Set([...dictionary(), word])];
    setDictionary(next);
    writeList(DICTIONARY_KEY, next);
  };
  const ignore = (word: string) => {
    const next = [...new Set([...ignored(), word])];
    setIgnored(next);
    writeList(IGNORE_KEY, next);
  };
  return { accepted, add, ignore };
}

export interface SpellCheckOptions {
  engine: PresentationEngine;
  session: PresentationSession;
  editor: SlideEditor;
  canEdit: Accessor<boolean>;
  /** Squiggles are shown (Normal view, not presenting). */
  visible: Accessor<boolean>;
}

/** How long edits settle before the slide is checked again (ms). */
const RECHECK_MS = 150;
/** The dictionary loads this long after the editor opens (ms). */
const LOAD_DELAY_MS = 1200;

export function createSpellCheck(options: SpellCheckOptions) {
  const { engine, session, editor } = options;
  const [speller, setSpeller] = createSignal<Speller>();
  const preferences = createSpellingPreferences();
  const [squiggles, setSquiggles] = createSignal<Squiggle[]>([]);

  async function ready(): Promise<Speller> {
    const current = speller();
    if (current) return current;
    const loaded = await loadSpeller();
    setSpeller(() => loaded);
    return loaded;
  }

  onMount(() => {
    const timer = setTimeout(() => {
      ready().catch((error: unknown) =>
        console.error('[pptx] the spelling dictionary did not load', error)
      );
    }, LOAD_DELAY_MS);
    onCleanup(() => clearTimeout(timer));
  });

  const accepted = () => {
    const words = preferences.accepted();
    return { has: (w: string) => words.has(w) };
  };

  /** The edited body: its key, live layout, and caret. */
  const edited = () => {
    const edit = editor.editing();
    if (!edit?.layout) return undefined;
    return {
      key: sourceKey(edit.shape, edit.cell),
      layout: edit.layout,
      caret: edit.selection.focus,
    };
  };

  /** Text layouts by slide and body, valid while the slide's render version holds. */
  const layouts = new Map<
    string,
    { version: number; layout: TextLayoutInfo | null }
  >();
  async function layoutOf(
    slideId: number,
    index: number,
    source: { shape: number; cell?: CellRef }
  ): Promise<TextLayoutInfo | null> {
    const key = `${slideId}/${sourceKey(source.shape, source.cell)}`;
    const version = session.slideVersion(slideId);
    const cached = layouts.get(key);
    if (cached && cached.version === version) return cached.layout;
    const layout = await engine
      .textLayout(index, source.shape, source.cell)
      .catch(() => null);
    layouts.set(key, { version, layout });
    return layout;
  }

  let generation = 0;
  async function check() {
    const run = ++generation;
    const s = speller();
    const slide = session.currentSlide();
    if (!s || !slide || !options.visible()) {
      setSquiggles([]);
      return;
    }
    const words = accepted();
    const live = edited();
    const found: Squiggle[] = [];
    const sources = slideTexts(slide);
    // The edited body may not be in the outline yet (a new text box).
    if (
      live &&
      !sources.some((src) => sourceKey(src.shape, src.cell) === live.key)
    )
      sources.push({
        shape: editor.editing()?.shape ?? 0,
        cell: editor.editing()?.cell,
        paragraphs: live.layout.paragraphs,
      });
    for (const source of sources) {
      const key = sourceKey(source.shape, source.cell);
      const isLive = live?.key === key;
      const body = isLive
        ? { ...source, paragraphs: live.layout.paragraphs }
        : source;
      let list = sourceMisspellings(slide, body, s, words);
      if (isLive) {
        // The word being typed is not flagged until the caret leaves it.
        const caret = live.caret;
        list = list.filter(
          (m) => !(m.paragraph === caret.paragraph && m.end === caret.offset)
        );
      }
      if (list.length === 0) continue;
      const layout = isLive
        ? live.layout
        : await layoutOf(slide.id, slide.index, source);
      if (run !== generation) return;
      if (!layout) continue;
      for (const m of list)
        found.push({
          ...m,
          ...wordGeometry(layout, m.paragraph, m.start, m.end),
        });
    }
    if (run === generation) setSquiggles(found);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let checkedSlide: number | undefined;
  const schedule = () => {
    // Another slide's underlines go at once rather than after the recheck.
    const slide = session.currentSlide()?.id;
    if (slide !== checkedSlide) {
      checkedSlide = slide;
      layouts.clear();
      setSquiggles([]);
    }
    clearTimeout(timer);
    timer = setTimeout(() => void check(), RECHECK_MS);
  };
  onCleanup(() => clearTimeout(timer));
  // Asking the engine for text layouts syncs with an external system.
  createEffect(
    on(
      [
        speller,
        session.currentSlide,
        preferences.accepted,
        options.visible,
        () => editor.editing()?.layout,
        () => editor.editing()?.selection.focus,
      ],
      schedule
    )
  );

  /** The misspelling drawn at slide point `p`. */
  const at = (p: Point): Squiggle | undefined =>
    squiggles().find((s) => s.boxes.some((box) => inQuad(box, p)));

  /**
   * Replaces occurrences with `replacement` (in each one's case: "Teh" →
   * "The"), as one undo step.
   */
  async function replace(occurrences: Misspelling[], replacement: string) {
    if (!options.canEdit() || occurrences.length === 0) return;
    const edit = editor.editing();
    // The dictionary's spelling, so each occurrence gets its own case
    // (proper nouns keep their capital).
    const lower = replacement.toLowerCase();
    const base = speller()?.correct(lower) ? lower : replacement;
    const result = await session.apply(
      replaceOps(occurrences, (m) => matchCase(m.word, base))
    );
    if (!result || !edit) return;
    // The caret goes after the corrected word, as in PowerPoint.
    const mine = occurrences.find(
      (m) =>
        m.shape === edit.shape &&
        sourceKey(m.shape, m.cell) === sourceKey(edit.shape, edit.cell)
    );
    await editor.refreshEditing();
    if (mine) {
      const caret = {
        paragraph: mine.paragraph,
        offset: mine.start + [...matchCase(mine.word, base)].length,
      };
      editor.selectText(caret, caret);
    }
  }

  /** Whether `word` would be flagged (after Add or Ignore All, it is not). */
  const flagged = (word: string) => {
    const s = speller();
    return !!s && misspelledWords(word, s, accepted()).length > 0;
  };

  return {
    speller,
    ready,
    squiggles,
    at,
    accepted,
    suggest: (word: string) => speller()?.suggest(word, 5) ?? [],
    replace,
    flagged,
    ignoreAll: (word: string) => preferences.ignore(word),
    addToDictionary: (word: string) => preferences.add(word),
  };
}

export type SpellCheck = ReturnType<typeof createSpellCheck>;
