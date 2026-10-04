/**
 * Slide transitions as Web Animations keyframes for the incoming and
 * outgoing slide images, approximating PowerPoint's effects.
 */

/** Keyframes for the incoming and outgoing slide of a transition. */
export interface TransitionFrames {
  incoming?: Keyframe[];
  outgoing?: Keyframe[];
}

/**
 * A transition as keyframes. OOXML directions name where the motion goes:
 * `l` moves leftwards, so a pushed slide enters from the right.
 */
export function transitionFrames(
  kind: string,
  direction: string | undefined
): TransitionFrames | null {
  const offset = (d: string | undefined) => {
    switch (d) {
      case 'r':
        return { from: 'translateX(-100%)', to: 'translateX(100%)' };
      case 'u':
        return { from: 'translateY(100%)', to: 'translateY(-100%)' };
      case 'd':
        return { from: 'translateY(-100%)', to: 'translateY(100%)' };
      case 'lu':
        return { from: 'translate(100%, 100%)', to: 'translate(-100%, -100%)' };
      case 'ru':
        return { from: 'translate(-100%, 100%)', to: 'translate(100%, -100%)' };
      case 'ld':
        return { from: 'translate(100%, -100%)', to: 'translate(-100%, 100%)' };
      case 'rd':
        return { from: 'translate(-100%, -100%)', to: 'translate(100%, 100%)' };
      default:
        return { from: 'translateX(100%)', to: 'translateX(-100%)' };
    }
  };
  const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  switch (kind) {
    case 'none':
    case 'cut':
      return null;
    case 'push': {
      const o = offset(direction);
      return {
        incoming: [{ transform: o.from }, { transform: 'none' }],
        outgoing: [{ transform: 'none' }, { transform: o.to }],
      };
    }
    case 'cover':
      return {
        incoming: [
          { transform: offset(direction).from },
          { transform: 'none' },
        ],
      };
    case 'uncover':
    case 'pull':
      // The old slide slides away and reveals the new one underneath.
      return {
        incoming: [{ opacity: 1 }, { opacity: 1 }],
        outgoing: [{ transform: 'none' }, { transform: offset(direction).to }],
      };
    case 'wipe':
      return {
        incoming: [
          {
            clipPath:
              direction === 'r'
                ? 'inset(0 100% 0 0)'
                : direction === 'u'
                  ? 'inset(100% 0 0 0)'
                  : direction === 'd'
                    ? 'inset(0 0 100% 0)'
                    : 'inset(0 0 0 100%)',
          },
          { clipPath: 'inset(0 0 0 0)' },
        ],
      };
    case 'split':
      return {
        incoming: [
          {
            clipPath: direction?.startsWith('horz')
              ? direction.endsWith('In')
                ? 'inset(0 0 0 0)'
                : 'inset(50% 0 50% 0)'
              : direction?.endsWith('In')
                ? 'inset(0 0 0 0)'
                : 'inset(0 50% 0 50%)',
          },
          { clipPath: 'inset(0 0 0 0)' },
        ],
      };
    case 'reveal':
      return {
        incoming: fadeIn,
        outgoing: [
          { transform: 'none', opacity: 1 },
          { transform: offset(direction).to, opacity: 0 },
        ],
      };
    case 'shape':
    case 'circle':
      return {
        incoming: [
          {
            clipPath:
              direction === 'diamond'
                ? 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)'
                : 'circle(0% at 50% 50%)',
          },
          {
            clipPath:
              direction === 'diamond'
                ? 'polygon(50% -50%, 150% 50%, 50% 150%, -50% 50%)'
                : 'circle(75% at 50% 50%)',
          },
        ],
      };
    case 'zoom':
      return direction === 'out'
        ? {
            incoming: fadeIn,
            outgoing: [
              { transform: 'none', opacity: 1 },
              { transform: 'scale(1.6)', opacity: 0 },
            ],
          }
        : {
            incoming: [
              { transform: 'scale(0.3)', opacity: 0 },
              { transform: 'none', opacity: 1 },
            ],
          };
    case 'flash':
      return {
        incoming: [
          { filter: 'brightness(4)', opacity: 0 },
          { filter: 'brightness(1)', opacity: 1 },
        ],
      };
    case 'fade':
      return direction === 'black'
        ? {
            incoming: [
              { opacity: 0 },
              { opacity: 0, offset: 0.5 },
              { opacity: 1 },
            ],
            outgoing: [
              { opacity: 1 },
              { opacity: 0, offset: 0.5 },
              { opacity: 0 },
            ],
          }
        : { incoming: fadeIn };
    default:
      // dissolve, randomBar, morph (approximated with a fade)...
      return { incoming: fadeIn };
  }
}
