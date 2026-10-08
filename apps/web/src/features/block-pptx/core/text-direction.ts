/**
 * PowerPoint's Text Direction choices (Home ▸ Paragraph, the Format pane's
 * Text Box section, and the table Layout tab), as `formatBody` directions.
 */

import type { TextDirection } from '@core/pptx-engine/types';

/** The menu's choices, in PowerPoint's order and wording. */
export const TEXT_DIRECTIONS: { value: TextDirection; label: string }[] = [
  { value: 'horz', label: 'Horizontal' },
  { value: 'vert', label: 'Rotate all text 90°' },
  { value: 'vert270', label: 'Rotate all text 270°' },
  { value: 'wordArtVert', label: 'Stacked' },
];

/** Directions only East Asian and WordArt text uses (shown when current). */
const OTHER_DIRECTIONS: { value: TextDirection; label: string }[] = [
  { value: 'eaVert', label: 'Vertical (East Asian)' },
  { value: 'mongolianVert', label: 'Mongolian vertical' },
  { value: 'wordArtVertRtl', label: 'Stacked, right to left' },
];

/** The choices to offer when `current` is the selection's direction. */
export const directionChoices = (current: TextDirection) => [
  ...TEXT_DIRECTIONS,
  ...OTHER_DIRECTIONS.filter((d) => d.value === current),
];
