import type { PropertyTrack, PropertySegment, ProgressKeyframes, ProgressKeyframe, Timeline } from '../types/types';
import { createTimeline } from '../utils/timeline';
import { linear } from '../easings/linear';

/*
  Progress-first keyframe format.

  Example:

  progressKeyframes({
    0:    [{ target: setScale, value: 1.0, easing: backOut },    { target: setX, value: 0,   easing: elasticOut }],
    0.25: [{ target: setScale, value: 0.6, easing: cubicOut }],
    0.5:  [{ target: setScale, value: 0.6, easing: backOut },    { target: setX, value: 100, easing: bounceOut }],
    0.75: [{ target: setScale, value: 1.2, easing: cubicInOut }],
    1:    [{ target: setScale, value: 1.0 },                     { target: setX, value: 0 }],
  })

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

export function progressKeyframes(timeline: ProgressKeyframes): Timeline {
  const keyframesByProperty = new Map<(value: number) => void, ProgressKeyframe[]>();

  for (const [progressStr, frame] of Object.entries(timeline)) {
    const progress = Number(progressStr);
    for (const { target, value, easing } of frame) {
      let list = keyframesByProperty.get(target);
      if (!list) {
        list = [];
        keyframesByProperty.set(target, list);
      }
      list.push({ progress, value, easing });
    }
  }

  const tracks: PropertyTrack[] = [];

  for (const [target, keyframes] of keyframesByProperty) {
    keyframes.sort((a, b) => a.progress - b.progress);

    const first = keyframes[0];
    const last = keyframes[keyframes.length - 1];
    if (first.progress > 0) { keyframes.unshift({ progress: 0, value: first.value, easing: first.easing }); }
    if (last.progress < 1) { keyframes.push({ progress: 1, value: last.value }); }

    const segments: PropertySegment[] = [];
    for (let i = 0; i < keyframes.length - 1; i++) {
      const from = keyframes[i];
      const to = keyframes[i + 1];
      const range = to.progress - from.progress;
      segments.push({
        rangeInverse: range > 0 ? 1 / range : 0,
        valueDelta: to.value - from.value,
        easing: from.easing ?? linear,
        fromProgress: from.progress,
        toProgress: to.progress,
        fromValue: from.value,
        toValue: to.value,
      });
    }

    if (segments.length > 0) { tracks.push({ target, segments }); }
  }

  if (tracks.length === 0) { throw new Error('progressKeyframes: no valid keyframes provided'); }
  return createTimeline(tracks);
}
