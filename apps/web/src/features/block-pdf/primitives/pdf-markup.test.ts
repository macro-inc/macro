import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { IPlaceable } from '../type/placeables';
import { PayloadMode } from '../type/placeables';
import { createPdfMarkup, type PdfMarkup } from './pdf-markup';

function textPlaceable(id: string, xPct: number): IPlaceable {
  return {
    internalId: id,
    allowableEdits: {
      allowResize: true,
      allowTranslate: true,
      allowRotate: true,
      allowDelete: true,
      lockAspectRatio: false,
    },
    wasEdited: false,
    wasDeleted: false,
    pageRange: new Set([0]),
    position: {
      xPct,
      yPct: 0.2,
      widthPct: 0.3,
      heightPct: 0.4,
      rotation: 0,
    },
    payload: {
      color: { red: 0, green: 0, blue: 0, alpha: 1 },
      fontSize: 10,
      bold: false,
      fontFamily: 'Times New Roman',
      text: 'draft',
      italic: false,
      underlined: false,
      textType: 'pdf-text',
    },
    payloadType: PayloadMode.FreeTextAnnotation,
    shouldLockOnSave: false,
    originalPage: 0,
    originalIndex: -1,
  };
}

function setup(): {
  markup: PdfMarkup;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    markup: createPdfMarkup(),
    dispose,
  }));
}

describe('createPdfMarkup', () => {
  it('coordinates placement, activation, drafts, and drag state', () => {
    const { markup, dispose } = setup();
    const firstDraft = textPlaceable('draft-1', 0.1);
    const movedDraft = textPlaceable('draft-1', 0.6);

    expect({
      mode: markup.mode(),
      activeId: markup.activeId(),
      draft: markup.draft(),
      dragActive: markup.dragActive(),
    }).toEqual({
      mode: PayloadMode.NoMode,
      activeId: undefined,
      draft: undefined,
      dragActive: false,
    });

    markup.commands.beginPlacement(PayloadMode.Signature);
    markup.commands.activate('draft-1');
    markup.commands.setDraft(firstDraft);
    markup.commands.setDraft(movedDraft);
    markup.commands.setDragActive(true);

    expect({
      mode: markup.mode(),
      activeId: markup.activeId(),
      draft: markup.draft(),
      dragActive: markup.dragActive(),
    }).toEqual({
      mode: PayloadMode.Signature,
      activeId: 'draft-1',
      draft: movedDraft,
      dragActive: true,
    });

    markup.commands.cancelPlacement();
    markup.commands.clearActive();
    markup.commands.clearDraft();
    markup.commands.setDragActive(false);

    expect({
      mode: markup.mode(),
      activeId: markup.activeId(),
      draft: markup.draft(),
      dragActive: markup.dragActive(),
    }).toEqual({
      mode: PayloadMode.NoMode,
      activeId: undefined,
      draft: undefined,
      dragActive: false,
    });
    dispose();
  });

  it('clears active and draft values only when ids match', () => {
    const { markup, dispose } = setup();
    const draft = textPlaceable('draft-1', 0.1);

    markup.commands.activate('draft-1');
    markup.commands.setDraft(draft);
    markup.commands.clearActiveIf('other');
    markup.commands.clearDraftIf('other');

    expect({
      activeId: markup.activeId(),
      draft: markup.draft(),
    }).toEqual({
      activeId: 'draft-1',
      draft,
    });

    markup.commands.clearActiveIf('draft-1');
    markup.commands.clearDraftIf('draft-1');

    expect({
      activeId: markup.activeId(),
      draft: markup.draft(),
    }).toEqual({
      activeId: undefined,
      draft: undefined,
    });
    dispose();
  });

  it('isolates markup authorities', () => {
    const first = setup();
    const second = setup();

    first.markup.commands.beginPlacement(PayloadMode.Thread);
    first.markup.commands.activate('draft-1');
    first.markup.commands.setDraft(textPlaceable('draft-1', 0.1));
    first.markup.commands.setDragActive(true);

    expect({
      firstMode: first.markup.mode(),
      firstActiveId: first.markup.activeId(),
      secondMode: second.markup.mode(),
      secondActiveId: second.markup.activeId(),
      secondDraft: second.markup.draft(),
      secondDragActive: second.markup.dragActive(),
    }).toEqual({
      firstMode: PayloadMode.Thread,
      firstActiveId: 'draft-1',
      secondMode: PayloadMode.NoMode,
      secondActiveId: undefined,
      secondDraft: undefined,
      secondDragActive: false,
    });
    first.dispose();
    second.dispose();
  });
});
