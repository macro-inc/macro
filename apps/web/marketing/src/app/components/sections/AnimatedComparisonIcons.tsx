import { createEffect, createUniqueId, type JSX } from 'solid-js';

type AnimatedIconProps = {
  triggerAnimation?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
};

export function AnimatedChannelIcon(props: AnimatedIconProps) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -4 24 24"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-channel-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
      style={props.style}
    >
      <style>{`
        @keyframes head-bounce {
          0% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
          80% { transform: translateY(1px); }
          100% { transform: translateY(0); }
        }
        .animated-channel-icon .head-left,
        .animated-channel-icon .head-center,
        .animated-channel-icon .head-right {
          transition: transform 0.4s ease;
        }
        .animated-channel-icon.animating .head-left {
          animation: head-bounce .2s;
        }
        .animated-channel-icon.animating .head-center {
          animation: head-bounce .2s 0.2s;
        }
        .animated-channel-icon.animating .head-right {
          animation: head-bounce .2s 0.4s;
        }
      `}</style>
      <path
        class="head-center"
        d="M12 11.6667C9.97333 11.6667 8.33333 10.0267 8.33333 8C8.33333 5.97333 9.97333 4.33333 12 4.33333C14.0267 4.33333 15.6667 5.97333 15.6667 8C15.6667 10.0267 14.0267 11.6667 12 11.6667ZM12 6.33333C11.08 6.33333 10.3333 7.08 10.3333 8C10.3333 8.92 11.08 9.66667 12 9.66667C12.92 9.66667 13.6667 8.92 13.6667 8C13.6667 7.08 12.92 6.33333 12 6.33333Z"
      />
      <path
        class="head-right"
        d="M20.3333 7.33333C18.3067 7.33333 16.6667 5.69333 16.6667 3.66667C16.6667 1.64 18.3067 0 20.3333 0C22.36 0 24 1.64 24 3.66667C24 5.69333 22.36 7.33333 20.3333 7.33333ZM20.3333 2C19.4133 2 18.6667 2.74667 18.6667 3.66667C18.6667 4.58667 19.4133 5.33333 20.3333 5.33333C21.2533 5.33333 22 4.58667 22 3.66667C22 2.74667 21.2533 2 20.3333 2Z"
      />
      <path
        class="head-left"
        d="M3.66667 7.33333C1.64 7.33333 0 5.69333 0 3.66667C0 1.64 1.64 0 3.66667 0C5.69333 0 7.33333 1.64 7.33333 3.66667C7.33333 5.69333 5.69333 7.33333 3.66667 7.33333ZM3.66667 2C2.74667 2 2 2.74667 2 3.66667C2 4.58667 2.74667 5.33333 3.66667 5.33333C4.58667 5.33333 5.33333 4.58667 5.33333 3.66667C5.33333 2.74667 4.58667 2 3.66667 2Z"
      />
      <path d="M7.33333 8.50667C6.30667 7.77333 5.05333 7.33333 3.69333 7.33333C2.33333 7.33333 1.04 7.78667 0 8.53333V11.44C0.76 10.1867 2.12 9.32 3.69333 9.32C5.26667 9.32 6.57333 10.1467 7.33333 11.3733V8.50667Z" />
      <path d="M24 8.50667C22.9733 7.77333 21.72 7.33333 20.36 7.33333C19 7.33333 17.7067 7.78667 16.6667 8.53333V11.44C17.4267 10.1867 18.7867 9.32 20.36 9.32C21.9333 9.32 23.24 10.1467 24 11.3733V8.50667Z" />
      <path d="M8.17333 16C8.89333 14.6267 10.3333 13.6667 12 13.6667C13.6667 13.6667 15.0933 14.6267 15.8267 16H17.9867C17.1467 13.4933 14.8 11.6667 12.0133 11.6667C9.22667 11.6667 6.88 13.4933 6.04 16H8.2H8.17333Z" />
    </svg>
  );
}

export function AnimatedFileMdIcon(props: AnimatedIconProps) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-file-md-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
      style={props.style}
    >
      <style>{`
        .animated-file-md-icon {
          .lower-l, .lower-extension {
            transition: transform 0.2s ease;
            transform-origin: center;
          }
          .line-2 {
            transform-origin: 15 6.75;
            transform: scale(.666, 1);
            transition: transform 0.2s ease-out;
            transform-box: fill-box;
          }
          .line-3 {
            transform-origin: 11 9.75;
            transform: scale(0, 1);
            transition: transform 0.2s ease-out 0.2s;
            transform-box: fill-box;
          }
        }
        .animated-file-md-icon.animating {
          .lower-l {
            transform: translateY(3px);
          }
          .line-2, .line-3 {
            transform: scale(1,1);
          }
          .lower-extension {
            transform: translateY(3px);
          }
        }
      `}</style>
      <path d="M17.25 0H1.5V1.5H16.5V10.5H18V0.75C18 0.34 17.66 0 17.25 0Z" />
      <path
        class="lower-l"
        d="M1.5 1.5H0V11.25C0 11.66 0.34 12 0.75 12H16.5V10.5H1.5V1.5Z"
      />
      <path d="M15 3.75H3V5.25H15V3.75Z" />
      <rect class="line-2" x="3" y="6.75" width="12" height="1.5" />
      <rect class="line-3" x="3" y="9.75" width="8" height="1.5" />
      <path class="upper-extension" d="M1.5 1.5H0V4.5H1.5V1.5Z" />
      <path class="lower-extension" d="M18 7.5H16.5V10.5H18V7.5Z" />
    </svg>
  );
}

const BODY_A_D = 'M 1.5,0.75 L 17.25,0.75 L 17.25,10.5';
const BODY_B_D = 'M 16.5,11.25 L 0.75,11.25 L 0.75,1.5';
const FLAP_D = 'M 1.5,1.5 L 9,7.5 L 17.25,0.75';
const PLANE_A_D = 'M 1.5,0.75 L 17.25,0.75 L 4.5,11.25';
const PLANE_B_D = 'M 17.25,0.75 L 4.5,11.25 L 0.75,1';
const PLANE_C_D = 'M 0.75,1 L 4.5,11.25 L 17.25,0.75';
const CUTOUT_D = 'M 3.5,6.7 L 7.3,4.2 L 2.85,4.8 Z';
const EMAIL_DURATION = 400;
const EMAIL_EASING = 'ease-in-out';
const pathKeyframe = (d: string) => `path('${d}')`;

function cancelAnimation(animation: Animation) {
  animation.finished.catch(() => {});
  try {
    animation.commitStyles();
    animation.cancel();
  } catch (_) {}
}

export function AnimatedEmailIcon(props: AnimatedIconProps) {
  const clipId = createUniqueId();
  let bodyAEl!: SVGPathElement;
  let bodyBEl!: SVGPathElement;
  let flapEl!: SVGPathElement;
  let cutoutEl!: SVGPathElement;
  let prevTrigger = false;
  let morphAnimations: Animation[] = [];
  let cutoutAnimation: Animation | null = null;

  createEffect(() => {
    const trigger = !!props.triggerAnimation;
    if (trigger === prevTrigger) return;
    prevTrigger = trigger;

    if (trigger) {
      for (const animation of morphAnimations) cancelAnimation(animation);
      morphAnimations = [];

      if (cutoutAnimation) {
        cutoutAnimation.finished.catch(() => {});
        try {
          cutoutAnimation.cancel();
        } catch (_) {}
        cutoutAnimation = null;
      }

      flapEl.setAttribute('stroke-linejoin', 'round');

      const options = {
        duration: EMAIL_DURATION,
        easing: EMAIL_EASING,
        fill: 'forwards' as FillMode,
      };
      morphAnimations = [
        bodyAEl.animate(
          [{ d: pathKeyframe(BODY_A_D) }, { d: pathKeyframe(PLANE_A_D) }],
          options
        ),
        bodyBEl.animate(
          [{ d: pathKeyframe(BODY_B_D) }, { d: pathKeyframe(PLANE_B_D) }],
          options
        ),
        flapEl.animate(
          [{ d: pathKeyframe(FLAP_D) }, { d: pathKeyframe(PLANE_C_D) }],
          options
        ),
      ];
      cutoutAnimation = cutoutEl.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: EMAIL_DURATION,
        easing: EMAIL_EASING,
        fill: 'both' as FillMode,
        delay: EMAIL_DURATION,
      });

      Promise.all(morphAnimations.map((animation) => animation.finished))
        .then(() => {
          for (const animation of morphAnimations) cancelAnimation(animation);
          morphAnimations = [];
        })
        .catch(() => {});
    } else {
      const isActive = (animation: Animation) =>
        animation.playState === 'running';

      for (const animation of morphAnimations.filter(
        (animation) => !isActive(animation)
      )) {
        cancelAnimation(animation);
      }
      const runningAnimations = morphAnimations.filter(isActive);

      if (runningAnimations.length > 0) {
        for (const animation of runningAnimations) animation.reverse();
        morphAnimations = runningAnimations;
      } else {
        const reverseOptions = {
          duration: EMAIL_DURATION,
          easing: EMAIL_EASING,
          fill: 'forwards' as FillMode,
          direction: 'reverse' as PlaybackDirection,
        };
        morphAnimations = [
          bodyAEl.animate(
            [{ d: pathKeyframe(BODY_A_D) }, { d: pathKeyframe(PLANE_A_D) }],
            reverseOptions
          ),
          bodyBEl.animate(
            [{ d: pathKeyframe(BODY_B_D) }, { d: pathKeyframe(PLANE_B_D) }],
            reverseOptions
          ),
          flapEl.animate(
            [{ d: pathKeyframe(FLAP_D) }, { d: pathKeyframe(PLANE_C_D) }],
            reverseOptions
          ),
        ];
      }

      if (cutoutAnimation) {
        const inDelayPhase =
          Number(cutoutAnimation.currentTime ?? 0) < EMAIL_DURATION;
        if (inDelayPhase) {
          cutoutAnimation.finished.catch(() => {});
          try {
            cutoutAnimation.cancel();
          } catch (_) {}
          cutoutAnimation = null;
        } else {
          try {
            cutoutAnimation.reverse();
          } catch (_) {}
        }
      }

      const morphsToWatch = [...morphAnimations];
      const cutoutToWatch = cutoutAnimation;
      const allToWatch = [
        ...morphsToWatch,
        ...(cutoutToWatch ? [cutoutToWatch] : []),
      ];

      Promise.all(allToWatch.map((animation) => animation.finished))
        .then(() => {
          for (const animation of morphsToWatch) cancelAnimation(animation);
          if (cutoutToWatch) cancelAnimation(cutoutToWatch);
          morphAnimations = [];
          if (cutoutAnimation === cutoutToWatch) cutoutAnimation = null;
          flapEl.setAttribute('stroke-linejoin', 'miter');
        })
        .catch(() => {});
    }
  });

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
      style={props.style}
    >
      <defs>
        <clipPath id={clipId}>
          <path d="M 1.5,-3 L 18,-3 L 18,15 L 0,15 L 0,1.5 L 1.5,1.5 Z" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${clipId})`}>
        <path ref={bodyAEl} d={BODY_A_D} stroke-linejoin="round" />
        <path ref={bodyBEl} d={BODY_B_D} stroke-linejoin="round" />
        <path ref={flapEl} d={FLAP_D} />
        <path
          ref={cutoutEl}
          d={CUTOUT_D}
          fill="currentColor"
          stroke="none"
          style={{ opacity: 0 }}
        />
      </g>
    </svg>
  );
}

export function AnimatedTaskIcon(props: AnimatedIconProps) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-task-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
      style={props.style}
    >
      <style>{`
        .animated-task-icon .box,
        .animated-task-icon .checkmark {
          transition: transform 0.4s ease;
        }
        .animated-task-icon.animating .box {
          transform: translateY(6px);
        }
        .animated-task-icon.animating .checkmark {
          transform: translateY(-7.5px);
        }
      `}</style>
      <path class="box" d="M1.5 0V1.5H4.5V4.5H1.5V1.5H0V6H6V0H1.5Z" />
      <path
        class="checkmark"
        d="M3.01 12L0 9L1.07 7.93L3.01 9.88L6.02 6.87L7.08 7.93L3.01 12Z"
      />
      <path d="M18 2.25H8V3.75H18V2.25Z" />
      <path d="M18 8.37H8V9.87H18V8.37Z" />
    </svg>
  );
}
