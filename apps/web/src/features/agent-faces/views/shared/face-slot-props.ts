import type { FaceDraft } from '../../primitives/create-face-draft';

export type FaceSlotProps = {
  draft: FaceDraft;
  /** The name's initials, shown if the picture fails to load. */
  initials: string;
  /** The face's width in px. */
  size: number;
};
