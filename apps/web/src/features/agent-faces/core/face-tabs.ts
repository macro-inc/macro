import { FACE_PARTS, type FacePart } from '@macro-inc/agent-faces';

/** The tabs of the face editor, in the order it shows them. */
export const FACE_TABS = ['head', 'hair', 'face', 'extras', 'outfit'] as const;
export type FaceTab = (typeof FACE_TABS)[number];

/** Which tab lists each part. A new part fails to compile until it has one. */
const TAB_OF_PART: Record<FacePart, FaceTab> = {
  head: 'head',
  skin: 'head',
  hair: 'hair',
  hairColor: 'hair',
  facialHair: 'hair',
  eyes: 'face',
  brows: 'face',
  nose: 'face',
  mouth: 'face',
  cheeks: 'face',
  glasses: 'extras',
  headwear: 'extras',
  earrings: 'extras',
  shirt: 'outfit',
  shirtColor: 'outfit',
  accent: 'outfit',
  background: 'outfit',
};

/** One row of the editor: a part and its options, as colours or as faces. */
export type FacePartRow = {
  part: FacePart;
  options: number;
  /** One `#rrggbb` per option, for parts that are a colour. */
  swatches?: readonly string[];
};

/** The parts a tab lists, in the library's order. */
export function partsOfTab(tab: FaceTab): FacePartRow[] {
  return FACE_PARTS.filter((entry) => TAB_OF_PART[entry.part] === tab);
}
