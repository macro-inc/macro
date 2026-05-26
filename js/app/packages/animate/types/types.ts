export type AnimationController = {
  onProgress(callback: (p: number) => void): AnimationController;
  onLoop(callback: (count: number) => void): AnimationController;
  onComplete(callback: () => void): AnimationController;
  onResume(callback: () => void): AnimationController;
  onPause(callback: () => void): AnimationController;
  duration(seconds: number): AnimationController;
  setSpeed(s: number): AnimationController;
  seek(p: number): AnimationController;
  pause(): AnimationController;
  loop(): AnimationController;
  play(): AnimationController;
  readonly isPlaying: boolean;
  readonly progress: number;
  readonly speed: number;
  destroy(): void;
};

export type EasingFn = (t: number) => number;

export type ProgressKeyframes = {
  [at: number]: ProgressKeyframeProperty[];
};

export type ProgressKeyframeProperty = {
  target: (val: number) => void;
  easing?: EasingFn;
  value: number;
};

export type PropertyKeyframeEntry = {
  easing?: (EasingFn | undefined)[];
  target: (val: number) => void;
  offset: number[];
  value: number[];
};

export type ProgressKeyframe = {
  easing?: EasingFn;
  progress: number;
  value: number;
};

export type PropertyTrack = {
  target: (val: number) => void;
  segments: PropertySegment[];
};

export type PropertySegment = {
  rangeInverse: number;
  fromProgress: number;
  toProgress: number;
  valueDelta: number;
  fromValue: number;
  easing: EasingFn;
  toValue: number;
};

export type ElasticOptions = {
  amplitude?: number;
  period?: number;
};

export type PlayOptions = {
  duration: number;
  speed?: number;
  loop?: boolean;
};

export type BackOptions = {
  overshoot?: number;
};

export type Timeline = {
  render(p: number): void;
};
