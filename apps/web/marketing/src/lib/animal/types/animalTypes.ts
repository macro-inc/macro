export type Timeline = { [at: number]: TimelineFrame };

export type InterpolateType =
  | 'elastic-in'
  | 'elastic-out'
  | 'elastic-in-out'
  | 'bounce-in'
  | 'bounce-out'
  | 'bounce-in-out'
  | 'cubic-in'
  | 'cubic-out'
  | 'cubic-in-out'
  | 'sine-in'
  | 'sine-out'
  | 'sine-in-out'
  | 'back-in'
  | 'back-out'
  | 'back-in-out'
  | 'quad-in'
  | 'quad-out'
  | 'quad-in-out'
  | 'spring'
  | 'linear';

export type Setter = (value: number) => void;

export type TimelineFrame = TimelineValue[];

export type InterpolateParams = {
  interpolate?: InterpolateType;
  overshoot?: number;
  stiffness?: number;
  amplitude?: number;
  damping?: number;
  period?: number;
  mass?: number;
};

export interface AnimateOptions {
  timeline: Timeline;
  duration: number;
  loop?: boolean;
}

export type TimelineValue = {
  interpolate?: InterpolateType;
  amplitude?: number;
  overshoot?: number;
  stiffness?: number;
  damping?: number;
  period?: number;
  signal: Setter;
  mass?: number;
  value: number;
};
