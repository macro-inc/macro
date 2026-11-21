import { type AgentFace, randomFace } from '@macro-inc/agent-faces';
import { type Accessor, createSignal } from 'solid-js';

/** How many faces the builder suggests at once. */
export const SUGGESTION_COUNT = 8;

export type FaceSuggestions = {
  faces: Accessor<readonly AgentFace[]>;
  /** Eight new faces in place of these; the chosen face is untouched. */
  regenerate: () => void;
};

const freshFaces = () =>
  Array.from({ length: SUGGESTION_COUNT }, () => randomFace());

/** Random faces to pick from, replaced as a set. */
export function createFaceSuggestions(): FaceSuggestions {
  const [faces, setFaces] = createSignal<readonly AgentFace[]>(freshFaces());
  return { faces, regenerate: () => setFaces(freshFaces()) };
}

/** Whether two faces draw the same: the same seed and the same pins. */
export function sameFace(a: AgentFace, b: AgentFace): boolean {
  const pins = (face: AgentFace) =>
    JSON.stringify(
      Object.entries(face.pins).sort(([x], [y]) => x.localeCompare(y))
    );
  return a.v === b.v && a.seed === b.seed && pins(a) === pins(b);
}
