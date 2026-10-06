export type AnimationTarget = {
  target: HTMLElement;
  keyframes: Keyframe[];
};

type AnimationGroup = {
  animations: Animation[];
  complete: () => void;
  afterRelease?: () => void;
};

/**
 * One interruptible WAAPI group. Callers capture keyframes before starting a
 * replacement and own presence, geometry, and disposal policy.
 */
export function createAnimationGroup() {
  let current: AnimationGroup | undefined;

  const release = (group: AnimationGroup) => {
    for (const animation of group.animations) {
      animation.onfinish = null;
      animation.cancel();
    }
  };
  const cancel = () => {
    const group = current;
    current = undefined;
    if (group) release(group);
  };
  const finish = () => {
    const group = current;
    if (!group) return;
    current = undefined;
    try {
      // Apply presence changes while the final animation frame still holds.
      group.complete();
    } finally {
      release(group);
      group.afterRelease?.();
    }
  };

  return {
    running: () => current !== undefined,
    cancel,
    finish,
    start(
      targets: readonly AnimationTarget[],
      options: KeyframeAnimationOptions,
      complete: () => void,
      afterRelease?: () => void
    ) {
      cancel();
      const group: AnimationGroup = {
        animations: targets.map(({ target, keyframes }) =>
          target.animate(keyframes, options)
        ),
        complete,
        afterRelease,
      };
      const primary = group.animations[0];
      if (!primary) {
        complete();
        afterRelease?.();
        return;
      }
      current = group;
      primary.onfinish = () => {
        if (current === group) finish();
      };
    },
  };
}
