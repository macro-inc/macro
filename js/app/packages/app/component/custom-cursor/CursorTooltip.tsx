/**
 * NOTE:
 * This component is intentionally a no-op placeholder.
 *
 * We previously had an experimental cursor tooltip implementation here, but it
 * does not belong in this PR and is not currently used by the app.
 *
 * Keeping the file (as an inert stub) avoids Biome `ci --changed` crashing on
 * deleted files in some environments.
 */
export function CursorTooltip() {
  return null;
}
