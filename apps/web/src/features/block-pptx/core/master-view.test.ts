import type {
  DeckOutline,
  MasterOutline,
  SlideOutline,
} from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  backgroundStylePreview,
  deleteBlocker,
  findMasterPage,
  layoutOptions,
  masterDeck,
  masterPageIds,
  pageTooltip,
  placeholderBox,
  slideRanges,
} from './master-view';

const BASE = 2147483648;

function master(): MasterOutline {
  return {
    id: BASE,
    name: 'Office Theme',
    placeholders: ['title', 'body', 'dt', 'ftr', 'sldNum'],
    layouts: [
      {
        id: BASE + 1,
        name: 'Title Slide',
        kind: 'title',
        slideIds: [256],
        placeholders: ['ctrTitle', 'subTitle'],
        hideBackgroundGraphics: false,
      },
      {
        id: BASE + 2,
        name: 'Title Only',
        kind: 'titleOnly',
        slideIds: [257, 258, 259, 261],
        placeholders: ['title'],
        hideBackgroundGraphics: false,
      },
      {
        id: BASE + 3,
        name: 'Blank',
        kind: 'blank',
        slideIds: [],
        placeholders: [],
        hideBackgroundGraphics: true,
      },
    ],
  };
}

function slide(id: number, index: number): SlideOutline {
  return { id, index, layout: '', hidden: false, shapes: [] };
}

function deck(masters = [master()]): DeckOutline {
  return {
    width: 960,
    height: 540,
    layouts: [],
    themeColors: [],
    tableStyles: [],
    slides: [256, 257, 258, 259, 260, 261].map(slide),
    masters,
  };
}

describe('Slide Master view pages', () => {
  it('lists each master, then its layouts', () => {
    expect(masterPageIds(deck())).toEqual([BASE, BASE + 1, BASE + 2, BASE + 3]);
    expect(masterPageIds({ ...deck(), masters: undefined })).toEqual([]);
  });

  it('finds masters and layouts by id', () => {
    const d = deck();
    expect(findMasterPage(d, BASE)?.layout).toBeUndefined();
    expect(findMasterPage(d, BASE + 2)?.layout?.name).toBe('Title Only');
    expect(findMasterPage(d, 256)).toBeUndefined();
  });

  it('puts the pages in place of the slides, renumbered', () => {
    const pages = [slide(BASE, 7), slide(BASE + 1, 9)];
    const shown = masterDeck({ ...deck(), sections: [] }, pages);
    expect(shown.slides.map((s) => [s.id, s.index])).toEqual([
      [BASE, 0],
      [BASE + 1, 1],
    ]);
    expect(shown.sections).toBeUndefined();
    expect(shown.masters).toEqual(deck().masters);
  });
});

describe('tooltips', () => {
  it('lists slide numbers as ranges', () => {
    expect(slideRanges([5, 1, 3, 4])).toBe('1, 3-5');
    expect(slideRanges([2])).toBe('2');
    expect(slideRanges([])).toBe('');
  });

  it("says which slides use a layout or a master's layouts", () => {
    const d = deck();
    expect(pageTooltip(d, findMasterPage(d, BASE + 2)!)).toBe(
      'Title Only Layout: used by slide(s) 2-4, 6'
    );
    expect(pageTooltip(d, findMasterPage(d, BASE + 3)!)).toBe(
      'Blank Layout: used by no slides'
    );
    expect(pageTooltip(d, findMasterPage(d, BASE)!)).toBe(
      'Office Theme Slide Master: used by slide(s) 1-4, 6'
    );
  });
});

describe('delete', () => {
  it('refuses used layouts, the last layout, and the last master', () => {
    const d = deck();
    expect(deleteBlocker(d, findMasterPage(d, BASE + 2)!)).toBe(
      'Slides use this layout'
    );
    expect(deleteBlocker(d, findMasterPage(d, BASE + 3)!)).toBeUndefined();
    expect(deleteBlocker(d, findMasterPage(d, BASE)!)).toBe(
      "Slides use this master's layouts"
    );
    const lonely: MasterOutline = {
      ...master(),
      layouts: [master().layouts[2]],
    };
    const single = deck([lonely]);
    expect(deleteBlocker(single, findMasterPage(single, BASE + 3)!)).toBe(
      'A slide master keeps at least one layout'
    );
    expect(deleteBlocker(single, findMasterPage(single, BASE)!)).toBe(
      'The presentation keeps at least one slide master'
    );
  });
});

describe('layout options', () => {
  it('reads Title and Footers from the placeholders', () => {
    const page = (kinds: string[]): SlideOutline => ({
      ...slide(BASE + 1, 1),
      shapes: kinds.map((placeholder, id) => ({
        id,
        name: '',
        kind: 'text',
        placeholder,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        rotation: 0,
        flipH: false,
        flipV: false,
        hidden: false,
        textEditable: true,
      })),
    });
    expect(layoutOptions(page(['ctrTitle', 'sldNum']))).toEqual({
      title: true,
      footers: true,
    });
    expect(layoutOptions(page(['body']))).toEqual({
      title: false,
      footers: false,
    });
    expect(layoutOptions(undefined)).toEqual({ title: false, footers: false });
  });

  it('places inserted placeholders in the middle, staggered', () => {
    const slideSize = { w: 960, h: 540 };
    expect(placeholderBox(slideSize, false)).toEqual({
      x: 320,
      y: 180,
      w: 320,
      h: 180,
    });
    const second = placeholderBox(slideSize, false, 1);
    expect([second.x, second.y]).toEqual([332, 192]);
    const vertical = placeholderBox(slideSize, true);
    expect(vertical.h).toBeGreaterThan(vertical.w);
  });
});

describe('background styles', () => {
  it('previews each style in its theme color', () => {
    const colors: [string, string][] = [
      ['dk1', '#000000'],
      ['lt1', '#FFFFFF'],
      ['dk2', '#44546A'],
      ['lt2', '#E7E6E6'],
    ];
    expect(backgroundStylePreview(colors, 1)).toBe('#FFFFFF');
    expect(backgroundStylePreview(colors, 2)).toBe('#000000');
    expect(backgroundStylePreview(colors, 8)).toContain('#44546A');
    expect(backgroundStylePreview(colors, 11)).toMatch(/^linear-gradient/);
  });
});
