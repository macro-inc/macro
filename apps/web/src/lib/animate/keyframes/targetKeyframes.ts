import type { PropertySegment, PropertyKeyframeEntry, Timeline } from '../types/types';
import { createTimeline } from '../utils/timeline';
import { linear } from '../easings/linear';

/*
  Property-first keyframe format.

  Example:

  propertyKeyframes([
    { target: setScale, offset: [0, 0.25, 0.5, 0.75, 1.0], value: [1.0, 0.6, 0.6, 1.2, 1.0], easing: [backOut, cubicOut, backOut, cubicInOut] },
    { target: setX, offset: [0, 0.5, 1.0], value: [0, 100, 0], easing: [elasticOut, bounceOut] },
  ])

  Compiles to PropertyTrack[]:

  [
    {
      target: setScale,
      segments: [
        { fromProgress: 0,    toProgress: 0.25, fromValue: 1.0, toValue: 0.6, easing: backOut },
        { fromProgress: 0.25, toProgress: 0.5,  fromValue: 0.6, toValue: 0.6, easing: cubicOut },
        { fromProgress: 0.5,  toProgress: 0.75, fromValue: 0.6, toValue: 1.2, easing: backOut },
        { fromProgress: 0.75, toProgress: 1.0,  fromValue: 1.2, toValue: 1.0, easing: cubicInOut },
      ]
    },
    {
      target: setX,
      segments: [
        { fromProgress: 0,   toProgress: 0.5, fromValue: 0,   toValue: 100, easing: elasticOut },
        { fromProgress: 0.5, toProgress: 1.0, fromValue: 100, toValue: 0,   easing: bounceOut },
      ]
    },
  ]
*/

export function targetKeyframes(entries: PropertyKeyframeEntry[]): Timeline {
  if (entries.length === 0) { throw new Error('propertyKeyframes: entries array cannot be empty'); }

  const tracks = [];

  for (const entry of entries) {
    const { target, offset, value, easing } = entry;

    if (offset.length === 0) { continue; }

    const easings = easing ? easing.slice() : undefined;
    const times = offset.slice();
    const vals = value.slice();


    const firstValue = vals[0];
    const lastValue = vals[vals.length - 1];
    const firstEasing = easings?.[0];
    const lastEasing = easings?.[easings.length - 1];

    if (times[0] > 0) {
      times.unshift(0);
      vals.unshift(firstValue);
      easings?.unshift(firstEasing);
    }
    if (times[times.length - 1] < 1) {
      times.push(1);
      vals.push(lastValue);
      easings?.push(lastEasing);
    }

    const segments: PropertySegment[] = [];
    for (let i = 0; i < times.length - 1; i++) {
      const fromProgress = times[i];
      const toProgress = times[i + 1];
      const fromValue = vals[i] ?? lastValue;
      const toValue = vals[i + 1] ?? lastValue;
      const r = toProgress - fromProgress;
      segments.push({
        easing: easings?.[i] ?? lastEasing ?? linear,
        rangeInverse: r > 0 ? 1 / r : 0,
        valueDelta: toValue - fromValue,
        fromProgress,
        toProgress,
        fromValue,
        toValue,
      });
    }

    tracks.push({ target, segments });
  }

  return createTimeline(tracks);
}
