import type { DeckOutline, EditResult } from '@core/pptx-engine/types';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  EditOutcome,
  PresentationEngine,
} from '../context/pptx-editor-context';
import { createPresentationSession } from './create-presentation-session';

function deck(title: string, ids = [256, 257]): DeckOutline {
  return {
    width: 960,
    height: 540,
    layouts: [],
    themeColors: [],
    slides: ids.map((id, index) => ({
      id,
      index,
      layout: 'Title Only',
      hidden: false,
      title,
      shapes: [],
    })),
  };
}

const changed: EditResult = {
  created: [],
  changedSlides: [256],
  structureChanged: false,
};

/** An engine whose open document is a title, swapped by `reopen`. */
function fakeEngine() {
  let title = 'Original';
  const history = { canUndo: false, canRedo: false };
  const outcome = (result: EditResult | null): EditOutcome => ({
    result,
    history,
  });
  const engine: PresentationEngine = {
    outline: async () => deck(title),
    slideOutline: async (index) => deck(title).slides[index],
    render: async () => {
      throw new Error('not rendered in tests');
    },
    renderLayer: async () => {
      throw new Error('not rendered in tests');
    },
    textLayout: async () => null,
    apply: async () => {
      history.canUndo = true;
      return outcome(changed);
    },
    breakGroup: async () => outcome(null),
    undo: async () => outcome(null),
    redo: async () => outcome(null),
    save: async () => new TextEncoder().encode(title),
    reopen: vi.fn(async (bytes: ArrayBuffer) => {
      title = new TextDecoder().decode(bytes);
    }),
    close: () => {},
  };
  return engine;
}

function setup(options: { persist?: () => Promise<void> } = {}) {
  const engine = fakeEngine();
  const watchers = new Set<() => void>();
  const notices: string[] = [];
  const errors: string[] = [];
  const replaced = vi.fn();
  let latest = 'Edited elsewhere';
  return createRoot((dispose) => {
    const session = createPresentationSession({
      engine,
      persist: options.persist ?? (async () => {}),
      canEdit: () => true,
      notifyError: (m) => errors.push(m),
      notifyInfo: (m) => notices.push(m),
      watchStoredFile: (onChange) => {
        watchers.add(onChange);
        return () => watchers.delete(onChange);
      },
      fetchLatest: async () =>
        new TextEncoder().encode(latest).buffer as ArrayBuffer,
      autosaveDelay: 0,
    });
    session.onReplaced(replaced);
    return {
      session,
      engine,
      notices,
      errors,
      replaced,
      dispose,
      setLatest: (value: string) => {
        latest = value;
      },
      announce: () => {
        for (const watcher of watchers) watcher();
      },
      watcherCount: () => watchers.size,
    };
  });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('presentation session reload', () => {
  it('loads the stored version when nothing is unsaved', async () => {
    const t = setup();
    await t.session.refresh();
    const before = t.session.slideVersion(256);

    expect(await t.session.reload()).toBe(true);

    expect(t.engine.reopen).toHaveBeenCalledTimes(1);
    expect(t.session.outline()?.slides[0].title).toBe('Edited elsewhere');
    expect(t.session.slideVersion(256)).toBeGreaterThan(before);
    expect(t.session.history()).toEqual({ canUndo: false, canRedo: false });
    expect(t.replaced).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  it('keeps unsaved edits instead of reloading', async () => {
    const t = setup();
    await t.session.refresh();
    await t.session.apply([{ op: 'deleteShape', slide: 256, shape: 2 }]);
    expect(t.session.saveState()).toBe('dirty');

    expect(await t.session.reload()).toBe(false);
    expect(t.engine.reopen).not.toHaveBeenCalled();
    expect(t.session.outline()?.slides[0].title).toBe('Original');
    t.dispose();
  });

  it('reloads on announcements and says so', async () => {
    const t = setup();
    await t.session.refresh();
    t.announce();
    await settle();
    await settle();
    expect(t.session.outline()?.slides[0].title).toBe('Edited elsewhere');
    expect(t.notices).toEqual(['Updated with changes made elsewhere.']);

    await t.session.apply([{ op: 'deleteShape', slide: 256, shape: 2 }]);
    t.setLatest('Edited again');
    t.announce();
    await settle();
    expect(t.session.outline()?.slides[0].title).toBe('Edited elsewhere');
    expect(t.notices.at(-1)).toMatch(/changed elsewhere/);
    expect(t.errors).toEqual([]);
    t.dispose();
  });

  it('stops watching when disposed', async () => {
    const t = setup();
    expect(t.watcherCount()).toBe(1);
    t.dispose();
    expect(t.watcherCount()).toBe(0);
  });
});
