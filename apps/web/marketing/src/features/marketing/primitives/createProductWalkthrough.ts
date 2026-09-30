import { createEmailWalkthrough } from './createEmailWalkthrough';

/** A visitor's edits also take precedence over later motion-preference changes. */
export function createProductWalkthrough(
  options: Parameters<typeof createEmailWalkthrough>[0]
) {
  let takenOver = false;
  const playback = createEmailWalkthrough({
    ...options,
    advance: (step) => {
      if (!takenOver) options.advance(step);
    },
    reduced: () => {
      if (!takenOver) options.reduced();
    },
  });
  return {
    pause: () => {
      takenOver = true;
      playback.pause();
    },
  };
}
