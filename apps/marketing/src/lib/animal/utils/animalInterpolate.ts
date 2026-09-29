import type { InterpolateParams } from '../types/animalTypes';

function elasticInOut(t: number, amplitude = 1, period = 0.45) {
  if (t === 0 || t === 1) {
    return t;
  }
  if (t < 0.5) {
    return (
      -(
        amplitude *
        Math.pow(2, 20 * t - 10) *
        Math.sin(
          ((20 * t - 10 - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) *
            (2 * Math.PI)) /
            period
        )
      ) / 2
    );
  }
  return (
    (amplitude *
      Math.pow(2, -20 * t + 10) *
      Math.sin(
        ((20 * t - 10 - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) *
          (2 * Math.PI)) /
          period
      )) /
      2 +
    1
  );
}
function elasticIn(t: number, amplitude = 1, period = 0.3) {
  if (t === 0 || t === 1) {
    return t;
  }
  return -(
    amplitude *
    Math.pow(2, 10 * (t - 1)) *
    Math.sin(
      ((t - 1 - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) *
        (2 * Math.PI)) /
        period
    )
  );
}
function elasticOut(t: number, amplitude = 1, period = 0.3) {
  if (t === 0 || t === 1) {
    return t;
  }
  return (
    amplitude *
      Math.pow(2, -10 * t) *
      Math.sin(
        ((t - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) *
          (2 * Math.PI)) /
          period
      ) +
    1
  );
}

function backOut(t: number, overshoot = 1.70158) {
  return (
    1 + (overshoot + 1) * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2)
  );
}
function backIn(t: number, overshoot = 1.70158) {
  return (overshoot + 1) * t * t * t - overshoot * t * t;
}
function backInOut(t: number, overshoot = 1.70158) {
  const c2 = overshoot * 1.525;
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
}

function bounceInOut(t: number) {
  return t < 0.5
    ? (1 - bounceOut(1 - 2 * t)) / 2
    : (1 + bounceOut(2 * t - 1)) / 2;
}
function bounceIn(t: number) {
  return 1 - bounceOut(1 - t);
}
function bounceOut(t: number) {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  }
  if (t < 2 / 2.75) {
    t -= 1.5 / 2.75;
    return 7.5625 * t * t + 0.75;
  }
  if (t < 2.5 / 2.75) {
    t -= 2.25 / 2.75;
    return 7.5625 * t * t + 0.9375;
  }
  t -= 2.625 / 2.75;
  return 7.5625 * t * t + 0.984375;
}

function cubicInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function cubicOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
function cubicIn(t: number) {
  return t * t * t;
}

function spring(t: number, stiffness = 100, damping = 10, mass = 1) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    );
  } else {
    return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
  }
}

function quadInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function quadOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
function quadIn(t: number) {
  return t * t;
}

function sineInOut(t: number) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
function sineIn(t: number) {
  return 1 - Math.cos((t * Math.PI) / 2);
}
function sineOut(t: number) {
  return Math.sin((t * Math.PI) / 2);
}

function linear(t: number) {
  return t;
}

export function getEasingFn(options: InterpolateParams): (t: number) => number {
  const {
    interpolate = 'linear',
    overshoot,
    amplitude,
    period,
    stiffness,
    damping,
    mass,
  } = options;

  switch (interpolate) {
    case 'elastic-in-out':
      return (t) => elasticInOut(t, amplitude, period);
    case 'elastic-out':
      return (t) => elasticOut(t, amplitude, period);
    case 'elastic-in':
      return (t) => elasticIn(t, amplitude, period);

    case 'spring':
      return (t) => spring(t, stiffness, damping, mass);

    case 'back-in-out':
      return (t) => backInOut(t, overshoot);
    case 'back-out':
      return (t) => backOut(t, overshoot);
    case 'back-in':
      return (t) => backIn(t, overshoot);

    case 'bounce-in-out':
      return bounceInOut;
    case 'bounce-out':
      return bounceOut;
    case 'bounce-in':
      return bounceIn;

    case 'sine-in-out':
      return sineInOut;
    case 'sine-out':
      return sineOut;
    case 'sine-in':
      return sineIn;

    case 'quad-in-out':
      return quadInOut;
    case 'quad-out':
      return quadOut;
    case 'quad-in':
      return quadIn;

    case 'cubic-in-out':
      return cubicInOut;
    case 'cubic-out':
      return cubicOut;
    case 'cubic-in':
      return cubicIn;

    default:
      return linear;
  }
}
