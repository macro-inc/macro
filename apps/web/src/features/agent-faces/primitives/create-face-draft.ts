import {
  type AgentFace,
  type FacePart,
  randomFace,
  shuffle as shuffleFace,
} from '@macro-inc/agent-faces';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** A photo chosen in place of a face, with a URL to show it until it is saved. */
export type FacePhoto =
  | { kind: 'upload'; file: File; url: string }
  | { kind: 'saved'; url: string };

/**
 * The picture being chosen for an agent: a generated face, or a photo. While
 * a photo is chosen the face is kept, so "Use a generated face" brings back
 * the same one.
 */
export type FaceDraft = {
  face: Accessor<AgentFace>;
  photo: Accessor<FacePhoto | undefined>;
  /** A new seed; pinned parts stay. */
  shuffle: () => void;
  /** Use `face` as it is: a suggestion the viewer picked. */
  choose: (face: AgentFace) => void;
  /** Fix `part` to its option at `index`. */
  pin: (part: FacePart, index: number) => void;
  /** Let the seed choose this part again. */
  unpin: (part: FacePart) => void;
  /** Let the seed choose every part again. */
  reset: () => void;
  /** Use a photo, or go back to the face with `undefined`. */
  setPhoto: (file: File | undefined) => void;
};

/** A draft starting from `initial`, or a random face. */
export function createFaceDraft(
  initial?: AgentFace,
  savedPhotoUrl?: string
): FaceDraft {
  const [face, setFace] = createSignal<AgentFace>(initial ?? randomFace());
  const [photo, setPhotoState] = createSignal<FacePhoto | undefined>(
    savedPhotoUrl ? { kind: 'saved', url: savedPhotoUrl } : undefined
  );

  const release = () => {
    const current = photo();
    if (current?.kind === 'upload') URL.revokeObjectURL(current.url);
  };
  onCleanup(release);

  return {
    face,
    photo,
    shuffle: () => setFace((current) => shuffleFace(current)),
    choose: (chosen) => setFace(chosen),
    pin: (part, index) =>
      setFace((current) => ({
        ...current,
        pins: { ...current.pins, [part]: index },
      })),
    unpin: (part) =>
      setFace((current) => {
        const pins = { ...current.pins };
        delete pins[part];
        return { ...current, pins };
      }),
    reset: () => setFace((current) => ({ ...current, pins: {} })),
    setPhoto: (file) => {
      release();
      setPhotoState(
        file
          ? { kind: 'upload', file, url: URL.createObjectURL(file) }
          : undefined
      );
    },
  };
}
