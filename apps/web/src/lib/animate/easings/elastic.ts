import type { EasingFn, ElasticOptions } from '../types/types';

export function elasticIn(opts: ElasticOptions = {}): EasingFn {
  const { amplitude: _amp = 1, period = 0.3 } = opts;
  const amplitude = Math.max(1, _amp);
  return (t) => {
    if (t === 0 || t === 1) return t;
    return -(amplitude * Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1 - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) * (2 * Math.PI)) / period));
  };
}

export function elasticOut(opts: ElasticOptions = {}): EasingFn {
  const { amplitude: _amp = 1, period = 0.3 } = opts;
  const amplitude = Math.max(1, _amp);
  return (t) => {
    if (t === 0 || t === 1) return t;
    return amplitude * Math.pow(2, -10 * t) * Math.sin(((t - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) * (2 * Math.PI)) / period) + 1;
  };
}

export function elasticInOut(opts: ElasticOptions = {}): EasingFn {
  const { amplitude: _amp = 1, period = 0.45 } = opts;
  const amplitude = Math.max(1, _amp);
  return (t) => {
    if (t === 0 || t === 1) return t;
    if (t < 0.5) return -(amplitude * Math.pow(2, 20 * t - 10) * Math.sin(((20 * t - 10 - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) * (2 * Math.PI)) / period)) / 2;
    return (amplitude * Math.pow(2, -20 * t + 10) * Math.sin(((20 * t - 10 - (period / (2 * Math.PI)) * Math.asin(1 / amplitude)) * (2 * Math.PI)) / period)) / 2 + 1;
  };
}
