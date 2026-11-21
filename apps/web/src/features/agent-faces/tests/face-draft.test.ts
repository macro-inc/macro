import { derivedAgentFace } from '@core/user/agent-face';
import { FACE_PARTS, parseAgentFace } from '@macro-inc/agent-faces';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { FACE_TABS, partsOfTab } from '../core/face-tabs';
import { createFaceDraft } from '../primitives/create-face-draft';

describe('face tabs', () => {
  it('list every part exactly once', () => {
    const listed = FACE_TABS.flatMap((tab) =>
      partsOfTab(tab).map((row) => row.part)
    );
    expect([...listed].sort()).toEqual(
      FACE_PARTS.map((entry) => entry.part).sort()
    );
  });
});

describe('createFaceDraft', () => {
  it('saves a derived face unchanged as the same face', () => {
    createRoot((dispose) => {
      const derived = derivedAgentFace('macro|ada@example.com');
      const draft = createFaceDraft(derived);
      expect(draft.face()).toEqual(derived);
      // What the server accepts and hands back is the same face.
      expect(parseAgentFace(JSON.parse(JSON.stringify(draft.face())))).toEqual(
        derived
      );
      dispose();
    });
  });

  it('keeps pins through a shuffle and drops them on reset', () => {
    createRoot((dispose) => {
      const draft = createFaceDraft({ v: 1, seed: 'start', pins: {} });
      draft.pin('hair', 2);
      draft.shuffle();
      expect(draft.face().seed).not.toBe('start');
      expect(draft.face().pins).toEqual({ hair: 2 });
      draft.pin('eyes', 1);
      draft.unpin('hair');
      expect(draft.face().pins).toEqual({ eyes: 1 });
      draft.reset();
      expect(draft.face().pins).toEqual({});
      dispose();
    });
  });

  it('starts with the saved photo and keeps the face when it is cleared', () => {
    createRoot((dispose) => {
      const draft = createFaceDraft(
        { v: 1, seed: 'start', pins: {} },
        'https://example.com/photo.png'
      );
      expect(draft.photo()).toEqual({
        kind: 'saved',
        url: 'https://example.com/photo.png',
      });
      draft.setPhoto(undefined);
      expect(draft.photo()).toBeUndefined();
      expect(draft.face().seed).toBe('start');
      dispose();
    });
  });

  it('keeps the face while a photo is chosen', () => {
    createRoot((dispose) => {
      const draft = createFaceDraft({ v: 1, seed: 'start', pins: {} });
      draft.setPhoto(new File(['x'], 'me.png', { type: 'image/png' }));
      const photo = draft.photo();
      expect(photo?.kind === 'upload' && photo.file.name).toBe('me.png');
      draft.setPhoto(undefined);
      expect(draft.photo()).toBeUndefined();
      expect(draft.face().seed).toBe('start');
      dispose();
    });
  });
});
