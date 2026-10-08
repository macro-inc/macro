/**
 * The open presentation as reactive state: its outline, the current slide,
 * undo history, which slides need re-rendering, and saving.
 *
 * Every change goes through `apply`/`undo`/`redo`, which keep the outline in
 * step with the engine and bump the render version of each slide whose
 * pixels changed. Saving is automatic after a short pause and on demand.
 * When the stored file changes elsewhere (an AI edit), the session loads it,
 * unless it holds unsaved edits of its own. A collaborative engine merges
 * such changes instead, and reports other people's edits as they arrive.
 *
 * In Slide Master view the outline's slides are the deck's masters and
 * layouts (read by id), so the slide editor edits them as it edits slides.
 */

import type {
  DeckOutline,
  EditOp,
  EditResult,
  SlideOutline,
} from '@core/pptx-engine/types';
import { type Accessor, batch, createSignal, onCleanup } from 'solid-js';
import type {
  EditOutcome,
  HistoryState,
  PresentationEngine,
} from '../context/pptx-editor-context';
import { masterDeck, masterPageIds } from '../core/master-view';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/** Normal editing, or Slide Master view (masters and layouts as the slides). */
export type SessionView = 'normal' | 'master';

export interface PresentationSessionOptions {
  engine: PresentationEngine;
  persist: (bytes: Uint8Array) => Promise<void>;
  canEdit: Accessor<boolean>;
  notifyError: (message: string) => void;
  notifyInfo?: (message: string) => void;
  /** Subscribes to outside changes of the stored file; returns an unsubscribe. */
  watchStoredFile?: (onChange: () => void) => () => void;
  /** The latest stored version. */
  fetchLatest?: () => Promise<ArrayBuffer>;
  /** Quiet period before an automatic save (ms); `0` disables autosave. */
  autosaveDelay?: number;
}

export interface PresentationSession {
  /**
   * The outline the editor shows: the deck, or in Slide Master view the deck
   * with its masters and layouts as the slides.
   */
  outline: Accessor<DeckOutline | undefined>;
  /** The deck itself (its slides), whatever the view. */
  deck: Accessor<DeckOutline | undefined>;
  view: Accessor<SessionView>;
  /**
   * Opens Slide Master view on the current slide's layout (PowerPoint's View
   * ▸ Slide Master).
   */
  enterMasterView: () => Promise<void>;
  /** Back to the slides (Close Master View), brought up to date. */
  exitMasterView: () => Promise<void>;
  slideIndex: Accessor<number>;
  setSlideIndex: (index: number) => void;
  currentSlide: Accessor<SlideOutline | undefined>;
  history: Accessor<HistoryState>;
  /** Render version of a slide; changes whenever its pixels may have changed. */
  slideVersion: (slideId: number) => number;
  saveState: Accessor<SaveState>;
  /** Applies a batch; resolves with what changed, or `null` when it was refused. */
  apply: (ops: EditOp[], group?: string) => Promise<EditResult | null>;
  undo: () => Promise<EditResult | null>;
  redo: () => Promise<EditResult | null>;
  breakGroup: () => void;
  /** Saves now (waits for a save already running). */
  save: () => Promise<void>;
  /** Reloads the outline from the engine. */
  refresh: () => Promise<void>;
  /**
   * Loads the latest stored version in place of the open one. Returns
   * whether it did: unsaved edits are never discarded.
   */
  reload: () => Promise<boolean>;
  /** Calls `listener` after the open presentation was replaced by `reload`. */
  onReplaced: (listener: () => void) => void;
}

export function createPresentationSession(
  options: PresentationSessionOptions
): PresentationSession {
  const { engine } = options;
  const [deck, setOutline] = createSignal<DeckOutline>();
  const [slideIndexRaw, setSlideIndexRaw] = createSignal(0);
  const [view, setView] = createSignal<SessionView>('normal');
  /** Slide Master view's outline: masters and layouts as slides. */
  const [pages, setPages] = createSignal<DeckOutline>();
  const [pageIndex, setPageIndex] = createSignal(0);
  /**
   * Slide outlines left stale in Slide Master view, where an edit can touch
   * every slide; they are read again on leaving it.
   */
  let slidesStale = false;
  const outline = () => (view() === 'master' ? pages() : deck());
  const slideIndex = () =>
    view() === 'master' ? pageIndex() : slideIndexRaw();
  const [history, setHistory] = createSignal<HistoryState>({
    canUndo: false,
    canRedo: false,
  });
  const [versions, setVersions] = createSignal<ReadonlyMap<number, number>>(
    new Map()
  );
  const [saveState, setSaveState] = createSignal<SaveState>('saved');

  /** Counts changes, so a save can tell whether edits arrived while it ran. */
  let changeCount = 0;
  let savedCount = 0;
  let saving: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const replacedListeners = new Set<() => void>();

  const clampIndex = (index: number, shown = outline()) =>
    Math.max(0, Math.min(index, (shown?.slides.length ?? 1) - 1));

  const setSlideIndex = (index: number) =>
    view() === 'master'
      ? setPageIndex(clampIndex(index, pages()))
      : setSlideIndexRaw(clampIndex(index, deck()));

  /** Slide Master view's outline for `base`: its masters' and layouts' outlines. */
  async function loadPages(base: DeckOutline): Promise<DeckOutline> {
    const ids = masterPageIds(base);
    return masterDeck(
      base,
      await Promise.all(ids.map((id) => engine.slideOutline(id)))
    );
  }

  const bump = (ids: Iterable<number>) =>
    setVersions((previous) => {
      const next = new Map(previous);
      for (const id of ids) next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });

  async function refresh() {
    const fresh = await engine.outline();
    const freshPages = view() === 'master' ? await loadPages(fresh) : undefined;
    batch(() => {
      setOutline(fresh);
      setSlideIndexRaw((i) => clampIndex(i, fresh));
      if (freshPages) {
        setPages(freshPages);
        setPageIndex((i) => clampIndex(i, freshPages));
      }
    });
  }

  /** Brings the outlines up to date with an edit result. */
  async function absorb(result: EditResult) {
    const current = deck();
    if (!current) return;
    const inMaster = view() === 'master';
    if (result.structureChanged) {
      const fresh = await engine.outline();
      const freshPages = inMaster ? await loadPages(fresh) : undefined;
      batch(() => {
        setOutline(fresh);
        // Slide numbers and thumbnails may all have moved.
        bump(fresh.slides.map((s) => s.id));
        setSlideIndexRaw((i) => clampIndex(i, fresh));
        if (freshPages) {
          setPages(freshPages);
          bump(freshPages.slides.map((s) => s.id));
          setPageIndex((i) => clampIndex(i, freshPages));
        }
      });
      return;
    }
    const changedPages = result.changedLayouts ?? [];
    if (result.changedSlides.length === 0 && changedPages.length === 0) return;
    if (inMaster && result.changedSlides.length > 0) slidesStale = true;
    const shownPages = pages();
    const [updates, pageUpdates] = await Promise.all([
      inMaster
        ? []
        : Promise.all(
            result.changedSlides
              .map((id) => current.slides.findIndex((s) => s.id === id))
              .filter((i) => i >= 0)
              .map((i) => engine.slideOutline(i))
          ),
      inMaster && shownPages
        ? Promise.all(
            changedPages
              .filter((id) => shownPages.slides.some((s) => s.id === id))
              .map((id) => engine.slideOutline(id))
          )
        : [],
    ]);
    batch(() => {
      if (updates.length > 0)
        setOutline((d) => {
          if (!d) return d;
          const slides = d.slides.map(
            (s) => updates.find((u) => u.id === s.id) ?? s
          );
          return { ...d, slides };
        });
      if (pageUpdates.length > 0)
        setPages((d) => {
          if (!d) return d;
          const slides = d.slides.map((s) => {
            const u = pageUpdates.find((p) => p.id === s.id);
            return u ? { ...u, index: s.index } : s;
          });
          return { ...d, slides };
        });
      bump([...result.changedSlides, ...changedPages]);
    });
  }

  async function enterMasterView() {
    const base = deck();
    if (!base || view() === 'master') return;
    const shown = await loadPages(base);
    const layoutId = base.slides[slideIndexRaw()]?.layoutId;
    const at = shown.slides.findIndex((s) => s.id === layoutId);
    batch(() => {
      setPages(shown);
      setPageIndex(Math.max(0, at));
      setView('master');
    });
  }

  async function exitMasterView() {
    if (view() !== 'master') return;
    const fresh = slidesStale ? await engine.outline() : undefined;
    slidesStale = false;
    batch(() => {
      setView('normal');
      setPages(undefined);
      if (fresh) {
        setOutline(fresh);
        setSlideIndexRaw((i) => clampIndex(i, fresh));
      }
    });
  }

  function scheduleSave() {
    const delay = options.autosaveDelay ?? 1500;
    if (delay <= 0) return;
    clearTimeout(timer);
    timer = setTimeout(() => void save().catch(() => {}), delay);
  }

  async function settle(outcome: EditOutcome): Promise<EditResult | null> {
    setHistory(outcome.history);
    const result = outcome.result;
    if (!result) return null;
    const changed = result.changedSlides.length > 0 || result.structureChanged;
    await absorb(result);
    if (changed) {
      changeCount++;
      setSaveState('dirty');
      scheduleSave();
    }
    return result;
  }

  async function run(
    action: () => Promise<EditOutcome>
  ): Promise<EditResult | null> {
    if (!options.canEdit()) return null;
    try {
      return await settle(await action());
    } catch (error) {
      options.notifyError(
        error instanceof Error ? error.message : 'The change could not be made.'
      );
      return null;
    }
  }

  async function save(): Promise<void> {
    clearTimeout(timer);
    if (saving) {
      await saving;
      if (changeCount === savedCount) return;
    }
    if (changeCount === savedCount) return;
    const target = changeCount;
    setSaveState('saving');
    saving = (async () => {
      try {
        const bytes = await engine.save();
        await options.persist(bytes);
        engine.onSaved?.(bytes);
        savedCount = target;
        if (!disposed)
          setSaveState(changeCount === savedCount ? 'saved' : 'dirty');
      } catch (error) {
        if (!disposed) setSaveState('error');
        options.notifyError(
          error instanceof Error
            ? error.message
            : 'The presentation could not be saved.'
        );
        throw error;
      } finally {
        saving = undefined;
      }
    })();
    await saving;
    if (changeCount !== savedCount) scheduleSave();
  }

  async function reload(): Promise<boolean> {
    const fetchLatest = options.fetchLatest;
    if (!fetchLatest || disposed) return false;
    if (engine.collaborative) {
      // Merged into the shared presentation; nobody's edits are replaced.
      await engine.reopen(await fetchLatest());
      return true;
    }
    if (saving || changeCount !== savedCount) return false;
    const bytes = await fetchLatest();
    // Edits made while downloading win: the next save keeps them.
    if (disposed || saving || changeCount !== savedCount) return false;
    await engine.reopen(bytes);
    const fresh = await engine.outline();
    const freshPages = view() === 'master' ? await loadPages(fresh) : undefined;
    batch(() => {
      setHistory({ canUndo: false, canRedo: false });
      setOutline(fresh);
      bump(fresh.slides.map((s) => s.id));
      setSlideIndexRaw((i) => clampIndex(i, fresh));
      if (freshPages) {
        setPages(freshPages);
        bump(freshPages.slides.map((s) => s.id));
        setPageIndex((i) => clampIndex(i, freshPages));
      }
    });
    for (const listener of replacedListeners) listener();
    return true;
  }

  async function onStoredFileChanged() {
    try {
      if (await reload()) {
        options.notifyInfo?.('Updated with changes made elsewhere.');
      } else if (!disposed && options.fetchLatest) {
        options.notifyInfo?.(
          'This presentation was changed elsewhere. Saving your edits will replace those changes.'
        );
      }
    } catch (error) {
      options.notifyError(
        error instanceof Error
          ? error.message
          : 'The latest version could not be loaded.'
      );
    }
  }
  const unwatch = options.watchStoredFile?.(() => void onStoredFileChanged());
  // Other people's edits: re-render, but leave saving them to their editor.
  const unsubscribeRemote = engine.onRemoteChange?.((result, state) => {
    if (disposed) return;
    setHistory(state);
    void absorb(result).catch((error: unknown) => {
      console.error('[pptx] could not show a change made elsewhere', error);
    });
  });

  // Unsaved work is flushed when the tab is hidden and when the editor closes.
  const onHide = () => {
    if (document.visibilityState === 'hidden' && changeCount !== savedCount) {
      void save().catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onHide);
  onCleanup(() => {
    unwatch?.();
    unsubscribeRemote?.();
    replacedListeners.clear();
    document.removeEventListener('visibilitychange', onHide);
    clearTimeout(timer);
    if (changeCount !== savedCount) void save().catch(() => {});
    disposed = true;
  });

  return {
    outline,
    deck,
    view,
    enterMasterView,
    exitMasterView,
    slideIndex,
    setSlideIndex,
    currentSlide: () => outline()?.slides[slideIndex()],
    history,
    slideVersion: (id) => versions().get(id) ?? 0,
    saveState,
    apply: (ops, group) => run(() => engine.apply(ops, group)),
    undo: () => run(() => engine.undo()),
    redo: () => run(() => engine.redo()),
    breakGroup: () => {
      void engine
        .breakGroup()
        .then((o) => setHistory(o.history))
        .catch(() => {});
    },
    save,
    refresh,
    reload,
    onReplaced: (listener) => {
      replacedListeners.add(listener);
    },
  };
}
