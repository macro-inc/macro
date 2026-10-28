import type {
  DeckOutline,
  EditResult,
  SlideOutline,
} from '@core/pptx-engine/types';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { pageAddressedEngine } from './create-master-view';
import { createPresentationSession } from './create-presentation-session';

const MASTER = 2147483648;
const TITLE_ONLY = MASTER + 1;
const BLANK = MASTER + 2;

/** A two-slide deck on "Title Only", whose titles are `title`. */
function deck(title: string): DeckOutline {
  return {
    width: 960,
    height: 540,
    layouts: [],
    themeColors: [],
    tableStyles: [],
    slides: [256, 257].map((id, index) => ({
      id,
      index,
      layout: 'Title Only',
      layoutId: TITLE_ONLY,
      hidden: false,
      title,
      shapes: [],
    })),
    masters: [
      {
        id: MASTER,
        name: 'Office Theme',
        placeholders: ['title'],
        layouts: [
          {
            id: TITLE_ONLY,
            name: 'Title Only',
            kind: 'titleOnly',
            slideIds: [256, 257],
            placeholders: ['title'],
            hideBackgroundGraphics: false,
          },
          {
            id: BLANK,
            name: 'Blank',
            kind: 'blank',
            slideIds: [],
            placeholders: [],
            hideBackgroundGraphics: false,
          },
        ],
      },
    ],
  };
}

/** An engine whose slides and pages carry `title`, changed by `apply`. */
function fakeEngine() {
  let title = 'Before';
  const result: EditResult = {
    created: [],
    changedSlides: [256, 257],
    changedLayouts: [TITLE_ONLY],
    structureChanged: false,
    replaced: 0,
  };
  const page = (id: number): SlideOutline => ({
    id,
    index: 99,
    layout: id === MASTER ? 'Office Theme' : 'Title Only',
    hidden: false,
    title: `${title} ${id}`,
    shapes: [],
  });
  const engine: PresentationEngine = {
    outline: vi.fn(async () => deck(title)),
    slideOutline: vi.fn(async (index: number) =>
      index >= MASTER ? page(index) : deck(title).slides[index]
    ),
    render: async () => {
      throw new Error('not rendered in tests');
    },
    renderLayer: async () => {
      throw new Error('not rendered in tests');
    },
    textLayout: vi.fn(async () => null),
    apply: async () => {
      title = 'After';
      return { result, history: { canUndo: true, canRedo: false } };
    },
    breakGroup: async () => ({
      result: null,
      history: { canUndo: true, canRedo: false },
    }),
    undo: async () => ({
      result: null,
      history: { canUndo: false, canRedo: false },
    }),
    redo: async () => ({
      result: null,
      history: { canUndo: false, canRedo: false },
    }),
    save: async () => new Uint8Array(),
    reopen: async () => {},
    close: () => {},
    copyShapes: vi.fn(async () => '{}'),
    copySlides: async () => '{}',
    findText: async () => [],
  };
  return engine;
}

describe('page addressed engine', () => {
  it('reads masters and layouts by id where slides are read by index', async () => {
    const engine = fakeEngine();
    let pages: number[] | undefined = [MASTER, TITLE_ONLY];
    const view = pageAddressedEngine(engine, () => pages);
    await view.slideOutline(1);
    await view.textLayout(0, 3);
    await view.copyShapes(1, [2]);
    expect(engine.slideOutline).toHaveBeenLastCalledWith(TITLE_ONLY);
    expect(engine.textLayout).toHaveBeenLastCalledWith(MASTER, 3, undefined);
    expect(engine.copyShapes).toHaveBeenLastCalledWith(TITLE_ONLY, [2]);
    pages = undefined;
    await view.slideOutline(1);
    expect(engine.slideOutline).toHaveBeenLastCalledWith(1);
  });
});

describe('Slide Master view session', () => {
  function setup() {
    const engine = fakeEngine();
    return createRoot((dispose) => {
      const session = createPresentationSession({
        engine,
        persist: async () => {},
        canEdit: () => true,
        notifyError: () => {},
        autosaveDelay: 0,
      });
      return { session, engine, dispose };
    });
  }

  it("opens on the current slide's layout and closes back on the slide", async () => {
    const { session, dispose } = setup();
    await session.refresh();
    session.setSlideIndex(1);
    await session.enterMasterView();
    expect(session.view()).toBe('master');
    expect(session.outline()?.slides.map((s) => [s.id, s.index])).toEqual([
      [MASTER, 0],
      [TITLE_ONLY, 1],
      [BLANK, 2],
    ]);
    expect(session.currentSlide()?.id).toBe(TITLE_ONLY);
    expect(session.deck()?.slides).toHaveLength(2);
    session.setSlideIndex(2);
    expect(session.currentSlide()?.id).toBe(BLANK);
    await session.exitMasterView();
    expect(session.view()).toBe('normal');
    expect(session.currentSlide()?.id).toBe(257);
    dispose();
  });

  it('refreshes edited pages at once and the slides on closing', async () => {
    const { session, engine, dispose } = setup();
    await session.refresh();
    await session.enterMasterView();
    const slideVersion = session.slideVersion(256);
    const pageVersion = session.slideVersion(TITLE_ONLY);
    await session.apply([
      { op: 'formatText', slide: TITLE_ONLY, shape: 2, props: { bold: true } },
    ]);
    expect(session.outline()?.slides[1].title).toBe(`After ${TITLE_ONLY}`);
    expect(session.outline()?.slides[1].index).toBe(1);
    expect(session.slideVersion(TITLE_ONLY)).toBeGreaterThan(pageVersion);
    expect(session.slideVersion(256)).toBeGreaterThan(slideVersion);
    // Slide outlines wait until the view closes.
    expect(session.deck()?.slides[0].title).toBe('Before');
    const outlines = vi.mocked(engine.outline).mock.calls.length;
    await session.exitMasterView();
    expect(engine.outline).toHaveBeenCalledTimes(outlines + 1);
    expect(session.outline()?.slides[0].title).toBe('After');
    dispose();
  });
});
