import {
  type SlideTransition,
  validSlideTransition,
} from '../slide-transition';
import { type BoxGeometry, validBoxGeometry } from './box-geometry';
import { boxShapeDefinition } from './embedded';

/**
 * A self-contained HTML document drawn into its box. Graphics treats `html` as
 * opaque content; hosts own sandboxing and rendering. The document lays out at
 * its design size and scales to fit the box. `presentOrder` is a sort key for
 * stepping through artifacts in presentation. `transition` plays when the
 * presentation enters this artifact; without one it uses the canvas's deck
 * default.
 */
export type ArtifactGeometry = BoxGeometry &
  Readonly<{
    title: string;
    html: string;
    designWidth: number;
    designHeight: number;
    presentOrder: string;
    transition?: SlideTransition;
  }>;

/** Authoring limit for hosts and AI edits. Stored scenes are not rejected over
 * it, so one oversized artifact can never stop a canvas from opening. */
export const ARTIFACT_HTML_MAX_LENGTH = 256_000;

const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const validArtifactGeometry = (v: unknown): v is ArtifactGeometry =>
  validBoxGeometry(v) &&
  'title' in v &&
  typeof v.title === 'string' &&
  'html' in v &&
  typeof v.html === 'string' &&
  'designWidth' in v &&
  positive(v.designWidth) &&
  'designHeight' in v &&
  positive(v.designHeight) &&
  'presentOrder' in v &&
  typeof v.presentOrder === 'string' &&
  !!v.presentOrder &&
  (!('transition' in v) ||
    v.transition === undefined ||
    validSlideTransition(v.transition));

export const artifactDefinition = boxShapeDefinition(
  'artifact',
  'Artifact',
  validArtifactGeometry
);
