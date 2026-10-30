/**
 * Slide transitions as Web Animations keyframes for the incoming and
 * outgoing slide images, approximating PowerPoint's effects.
 */

import { match as matchBranch } from 'ts-pattern';
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
    return matchBranch(d)
      .with('r', () => {
        return { from: 'translateX(-100%)', to: 'translateX(100%)' };
      })
      .with('u', () => {
        return { from: 'translateY(100%)', to: 'translateY(-100%)' };
      })
      .with('d', () => {
        return { from: 'translateY(-100%)', to: 'translateY(100%)' };
      })
      .with('lu', () => {
        return { from: 'translate(100%, 100%)', to: 'translate(-100%, -100%)' };
      })
      .with('ru', () => {
        return { from: 'translate(-100%, 100%)', to: 'translate(100%, -100%)' };
      })
      .with('ld', () => {
        return { from: 'translate(100%, -100%)', to: 'translate(-100%, 100%)' };
      })
      .with('rd', () => {
        return { from: 'translate(-100%, -100%)', to: 'translate(100%, 100%)' };
      })
      .otherwise(() => {
        return { from: 'translateX(100%)', to: 'translateX(-100%)' };
      });
  };
  const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  return matchBranch(kind)
    .with('none', 'cut', (): TransitionFrames | null => {
      return null;
    })
    .with('push', (): TransitionFrames | null => {
      {
        const o = offset(direction);
        return {
          incoming: [{ transform: o.from }, { transform: 'none' }],
          outgoing: [{ transform: 'none' }, { transform: o.to }],
        };
      }
    })
    .with('cover', (): TransitionFrames | null => {
      return {
        incoming: [
          { transform: offset(direction).from },
          { transform: 'none' },
        ],
      };
    })
    .with('uncover', 'pull', (): TransitionFrames | null => {
      return {
        incoming: [{ opacity: 1 }, { opacity: 1 }],
        outgoing: [{ transform: 'none' }, { transform: offset(direction).to }],
      };
    })
    .with('wipe', (): TransitionFrames | null => {
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
    })
    .with('split', (): TransitionFrames | null => {
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
    })
    .with('reveal', (): TransitionFrames | null => {
      return {
        incoming: fadeIn,
        outgoing: [
          { transform: 'none', opacity: 1 },
          { transform: offset(direction).to, opacity: 0 },
        ],
      };
    })
    .with('shape', 'circle', (): TransitionFrames | null => {
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
    })
    .with('zoom', (): TransitionFrames | null => {
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
    })
    .with('flash', (): TransitionFrames | null => {
      return {
        incoming: [
          { filter: 'brightness(4)', opacity: 0 },
          { filter: 'brightness(1)', opacity: 1 },
        ],
      };
    })
    .with('fade', (): TransitionFrames | null => {
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
    })
    .otherwise((): TransitionFrames | null => {
      return { incoming: fadeIn };
    });
}
