import type { JSX } from 'solid-js';
import { twMerge } from 'tailwind-merge';

/**
 * BrightJoins
 *
 * @param props.dots - The dots to show in the corners. [top-left, top-right, bottom-right, bottom-left]
 * @param props.class - Any overrides to the default styles
 *
 * @example
 * ```tsx
 * <div class="relative">
 *   <BrightJoins dots={[true, true, true, true]} />
 * </div>
 * ```
 */
export function BrightJoins(props: {
  dots?: [boolean, boolean, boolean, boolean];
  class?: string;
}): JSX.Element {
  const backgroundStyles = () => {
    const [tl, tr, br, bl] = props.dots ?? [true, true, true, true];
    const layers: string[] = [];
    const positions: string[] = [];
    if (tl) {
      layers.push('linear-gradient(currentColor, currentColor)');
      positions.push('top left');
    }
    if (tr) {
      layers.push('linear-gradient(currentColor, currentColor)');
      positions.push('top right');
    }
    if (br) {
      layers.push('linear-gradient(currentColor, currentColor)');
      positions.push('bottom right');
    }
    if (bl) {
      layers.push('linear-gradient(currentColor, currentColor)');
      positions.push('bottom left');
    }
    return {
      'background-image': layers.join(', '),
      'background-position': positions.join(', '),
    };
  };

  return (
    <div
      class={twMerge(
        'absolute inset-[-1px] z-200 pointer-events-none bg-no-repeat bg-size-[1px_1px]',
        props.class
      )}
      style={backgroundStyles()}
    />
  );
}

/**
 * Progress meter to complement BrightJoins. Just put them next to each other.
 *
 * @param props.progress - The progress percentage (0-100)
 * @param props.class - Any overrides to the default styles
 *
 * @example
 * ```tsx
 * <div class="relative">
 *   <BrightJoins />
 *   <BrightJoinsProgressMeter progress={50} class="from-accent to-accent-bg" />
 * </div>
 * ```
 */
export function BrightJoinsProgressMeter(props: {
  progress: number;
  class?: string;
}) {
  return (
    <div
      class={twMerge(
        '-top-px left-[2px] absolute bg-gradient-to-r from-edge to-ink w-[calc(var(--onboarding-progress)-4px)] h-px transition-[width] duration-1000',
        props.class
      )}
      style={{
        '--onboarding-progress': `${props.progress}%`,
      }}
    ></div>
  );
}
