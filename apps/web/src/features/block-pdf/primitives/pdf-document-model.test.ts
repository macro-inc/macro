import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  type IModificationDataOnServer,
  transformModificationDataToServer,
} from '../type/coParse';
import {
  type IPlaceable,
  PayloadMode,
  type PayloadType,
} from '../type/placeables';
import {
  createPdfDocumentModel,
  type PdfDocumentModel,
} from './pdf-document-model';

function textPlaceable(text: string): IPlaceable {
  return {
    internalId: 'placeable-1',
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
      xPct: 0.1,
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
      text,
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

function withModel(run: (model: PdfDocumentModel) => void) {
  createRoot((dispose) => {
    try {
      run(createPdfDocumentModel());
    } finally {
      dispose();
    }
  });
}

describe('createPdfDocumentModel', () => {
  it('starts empty and hydrates the server baseline without recording an edit', () => {
    withModel((model) => {
      const snapshot = transformModificationDataToServer({
        bookmarks: [],
        pinnedTermsNames: ['defined term'],
        placeables: [textPlaceable('from server')],
      }) satisfies IModificationDataOnServer;

      expect(model.modificationData).toEqual({
        bookmarks: [],
        placeables: [],
        pinnedTermsNames: [],
      });
      expect(model.serverSnapshot()).toBeUndefined();
      expect(model.hasServerSnapshot()).toBe(false);
      expect(model.revision()).toBe(0);

      model.commands.hydrateFromServer(snapshot);

      expect(model.serverSnapshot()).toBe(snapshot);
      expect(model.hasServerSnapshot()).toBe(true);
      expect(model.modificationData.bookmarks).toEqual([]);
      expect(model.modificationData.pinnedTermsNames).toEqual(['defined term']);
      expect(model.modificationData.placeables).toHaveLength(1);
      expect(model.modificationData.placeables[0]?.payload).toMatchObject({
        text: 'from server',
      });
      expect(model.modificationData.placeables[0]?.internalId).toEqual(
        expect.any(String)
      );
      expect(model.revision()).toBe(0);
    });
  });

  it('owns placeable replacement, edits, deletion, and revision changes', () => {
    withModel((model) => {
      const original = textPlaceable('before');
      const updated = textPlaceable('after');
      const mismatched = {
        ...updated,
        payloadType: PayloadMode.Signature as PayloadType,
      } as IPlaceable;

      model.commands.appendPlaceable(original);
      expect(model.modificationData.placeables).toEqual([original]);
      expect(model.revision()).toBe(0);

      model.commands.replacePlaceables([original]);
      expect(model.modificationData.placeables).toEqual([original]);
      expect(model.revision()).toBe(0);

      expect(model.commands.updatePlaceable(-1, updated)).toBe(false);
      expect(model.commands.updatePlaceable(1, updated)).toBe(false);
      expect(model.commands.updatePlaceable(0, mismatched)).toBe(false);
      expect(model.commands.removePlaceable(-1)).toBe(false);
      expect(model.commands.removePlaceable(1)).toBe(false);
      expect(model.revision()).toBe(0);

      expect(model.commands.updatePlaceable(0, updated)).toBe(true);
      expect(model.modificationData.placeables[0]).toEqual({
        ...updated,
        wasEdited: true,
      });
      expect(model.revision()).toBe(1);

      expect(model.commands.removePlaceable(0)).toBe(true);
      expect(model.modificationData.placeables).toEqual([]);
      expect(model.revision()).toBe(2);

      model.commands.recordEdit();
      expect(model.revision()).toBe(3);
    });
  });
});
