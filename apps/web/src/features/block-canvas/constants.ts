export const URL_PARAMS = {
  x: 'canvas_x',
  y: 'canvas_y',
  s: 'canvas_scale',
} as const;

/** An artifact's slide-position bar. Canvas pointer handlers leave presses
 * inside it to its buttons. */
export const ARTIFACT_CONTROLS_SELECTOR = '[data-canvas-artifact-controls]';
