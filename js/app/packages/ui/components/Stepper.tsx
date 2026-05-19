import { children, createMemo, type JSX, Show } from 'solid-js';
import { Transition } from 'solid-transition-group';
import { cn } from '../utils/classname';

/*
<Stepper step={step()} transition={Stepper.transitions.slide}>
  <Stepper.Step><IntroStep /></Stepper.Step>
  <Stepper.Step><ProfileStep /></Stepper.Step>
  <Stepper.Step><TeamStep /></Stepper.Step>
  <Stepper.Step><PaymentStep /></Stepper.Step>
</Stepper>
*/

export type StepperTransition = {
  mode?: 'outin' | 'inout';                /* simultaneous if omitted   */
  enterActiveClass?: string;
  enterClass?: string;
  enterToClass?: string;
  exitActiveClass?: string;
  exitClass?: string;
  exitToClass?: string;
};

/* Resolver receives 1 for forward navigation, -1 for backward */
export type StepperTransitionResolver = (direction: 1 | -1) => StepperTransition;

export type StepperProps = {
  step: number;                                                       /* current step index    */
  transition?: StepperTransition | StepperTransitionResolver;         /* transition behavior   */
  appear?: boolean;                                                   /* animate initial mount */
  children: JSX.Element;                                              /* Stepper.Step slots    */
  class?: string;                                                     /* container classes     */
};

export type StepperStepProps = {
  index?: number;                                                     /* override position     */
  noTransition?: boolean;                                             /* skip enter+exit anim  */
  children: JSX.Element;                                              /* step contents (lazy)  */
};

const FADE: StepperTransition = {
  mode: 'outin',
  enterActiveClass: 'transition-opacity duration-200 ease-out',
  enterClass: 'opacity-0',
  enterToClass: 'opacity-100',
  exitActiveClass: 'transition-opacity duration-150 ease-in',
  exitClass: 'opacity-100',
  exitToClass: 'opacity-0',
};

const SLIDE: StepperTransitionResolver = (dir) => ({
  enterActiveClass: 'transition-all duration-300 ease-out',
  enterClass: dir === 1 ? 'opacity-0 translate-x-6' : 'opacity-0 -translate-x-6',
  enterToClass: 'opacity-100 translate-x-0',
  exitActiveClass: 'transition-all duration-300 ease-in',
  exitClass: 'opacity-100 translate-x-0',
  exitToClass: dir === 1 ? 'opacity-0 -translate-x-6' : 'opacity-0 translate-x-6',
});

const SLIDE_FULL: StepperTransitionResolver = (dir) => ({
  enterActiveClass: 'transition-transform duration-300 ease-out',
  enterClass: dir === 1 ? 'translate-x-full' : '-translate-x-full',
  enterToClass: 'translate-x-0',
  exitActiveClass: 'transition-transform duration-300 ease-out',
  exitClass: 'translate-x-0',
  exitToClass: dir === 1 ? '-translate-x-full' : 'translate-x-full',
});

const SCALE: StepperTransition = {
  mode: 'outin',
  enterActiveClass: 'transition-all duration-200 ease-out',
  enterClass: 'opacity-0 scale-95',
  enterToClass: 'opacity-100 scale-100',
  exitActiveClass: 'transition-all duration-150 ease-in',
  exitClass: 'opacity-100 scale-100',
  exitToClass: 'opacity-0 scale-95',
};

/* Same trick as solid-js's Match: returning the props object lets the parent
   Stepper read `index`/`children` without evaluating the JSX subtree. Solid's
   JSX compiler keeps `children` as a getter, so it stays lazy until the
   matching step is actually rendered. */
function Step(props: StepperStepProps): JSX.Element {
  return props as unknown as JSX.Element;
}

function StepperRoot(props: StepperProps) {
  const resolved = children(() => props.children);

  const stepList = createMemo(() => {
    const raw = resolved.toArray() as unknown as StepperStepProps[];
    return Array.isArray(raw) ? raw : [raw];
  });

  const activeStep = createMemo(() =>
    stepList().find((step, i) => (step.index ?? i) === props.step)
  );

  /* Track previous step so we can derive direction and decide whether the
     swap should be instant (when either side opts out of animation). Memo +
     closed-over `prev` is the standard "previous value" pattern — idempotent
     because the memo only re-runs when `props.step` changes. */
  const transitionState = (() => {
    let prevIdx = props.step;
    let prevStep = activeStep();
    return createMemo(() => {
      const nextIdx = props.step;
      const nextStep = activeStep();
      const direction: 1 | -1 = nextIdx >= prevIdx ? 1 : -1;
      const instant = !!(prevStep?.noTransition || nextStep?.noTransition);
      prevIdx = nextIdx;
      prevStep = nextStep;
      return { direction, instant };
    });
  })();

  const transition = createMemo<StepperTransition>(() => {
    const t = props.transition;
    if (!t) return FADE;
    return typeof t === 'function' ? t(transitionState().direction) : t;
  });

  const slot = (step: StepperStepProps) => (
    <div class="min-w-0 min-h-0" style={{ 'grid-area': 'stack' }}>
      {step.children}
    </div>
  );

  return (
    <div
      class={cn('grid relative', props.class)}
      style={{
        'grid-template-areas': '"stack"',
        'grid-template-columns': 'minmax(0, 1fr)',
        'grid-template-rows': 'minmax(0, 1fr)',
      }}
    >
      <Show
        when={!transitionState().instant}
        fallback={
          <Show when={activeStep()} keyed>
            {(step) => slot(step)}
          </Show>
        }
      >
        <Transition
          appear={props.appear}
          mode={transition().mode}
          enterActiveClass={transition().enterActiveClass}
          enterClass={transition().enterClass}
          enterToClass={transition().enterToClass}
          exitActiveClass={transition().exitActiveClass}
          exitClass={transition().exitClass}
          exitToClass={transition().exitToClass}
        >
          <Show when={activeStep()} keyed>
            {(step) => slot(step)}
          </Show>
        </Transition>
      </Show>
    </div>
  );
}

export const Stepper = Object.assign(StepperRoot, {
  Step,
  transitions: {
    fade: FADE,
    slide: SLIDE,
    slideFull: SLIDE_FULL,
    scale: SCALE,
  },
});
