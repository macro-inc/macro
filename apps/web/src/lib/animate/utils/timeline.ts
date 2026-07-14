import type { PropertyTrack, Timeline, EasingFn } from '../types/types';

/*
  Given the example PropertyTrack[] produced by `progressKeyframes`:

  [
    {
      target: setScale,
      segments: [
        { fromProgress: 0,    toProgress: 0.25, fromValue: 1.0, toValue: 0.6, valueDelta: -0.4, rangeInverse: 4, easing: backOut },
        { fromProgress: 0.25, toProgress: 0.5,  fromValue: 0.6, toValue: 0.6, valueDelta:  0.0, rangeInverse: 4, easing: cubicOut },
        { fromProgress: 0.5,  toProgress: 0.75, fromValue: 0.6, toValue: 1.2, valueDelta:  0.6, rangeInverse: 4, easing: backOut },
        { fromProgress: 0.75, toProgress: 1.0,  fromValue: 1.2, toValue: 1.0, valueDelta: -0.2, rangeInverse: 4, easing: cubicInOut },
      ],
    },
    {
      target: setX,
      segments: [
        { fromProgress: 0,   toProgress: 0.5, fromValue: 0,   toValue: 100, valueDelta:  100, rangeInverse: 2, easing: elasticOut },
        { fromProgress: 0.5, toProgress: 1.0, fromValue: 100, toValue: 0,   valueDelta: -100, rangeInverse: 2, easing: bounceOut },
      ],
    },
  ]

  ...createTimeline compiles into a struct-of-arrays layout, indexed by track:

  trackCount = 2

  setters            = [ setScale,                       setX                  ]
  segmentLengths     = [ 4,                              2                     ]
  lastIndices        = [ 3,                              1                     ]
  cachedIndices      = Uint32Array [ 0, 0 ]  // mutated per render

  fromProgressArrays = [ Float32Array [0,    0.25, 0.5,  0.75], Float32Array [0,    0.5 ] ]
  toProgressArrays   = [ Float32Array [0.25, 0.5,  0.75, 1.0 ], Float32Array [0.5,  1.0 ] ]
  fromValueArrays    = [ Float32Array [1.0,  0.6,  0.6,  1.2 ], Float32Array [0,    100 ] ]
  valueDeltaArrays   = [ Float32Array [-0.4, 0.0,  0.6, -0.2 ], Float32Array [100, -100 ] ]
  rangeInverseArrays = [ Float32Array [4,    4,    4,    4   ], Float32Array [2,    2   ] ]
  easingArrays       = [ [backOut, cubicOut, backOut, cubicInOut], [elasticOut, bounceOut] ]

  Why: hot-path render() reads parallel typed arrays by index, avoiding object
  property lookups and pointer chasing. Segments per track are tiny (here 4 and 2),
  so the linear-scan branch (len <= 4) skips the binary search, and cachedIndices
  short-circuits the lookup entirely while progress stays inside the same segment.

  Example: render(0.6) on the setScale track
    cachedIndices[0] = 0 (stale)  -> fromP=0, toP=0.25, not in cached
    linear scan from j=3 down: fromProgressArr[2]=0.5 <= 0.6 -> idx = 2
    cachedIndices[0] = 2
    localProgress  = (0.6 - 0.5) * 4         = 0.4
    mappedProgress = backOut(0.4)            ~ 0.9
    setScale(0.6 + 0.6 * 0.9)                ~ setScale(1.14)
*/

export function createTimeline(tracks: PropertyTrack[]): Timeline {
  const trackCount = tracks.length;

  const rangeInverseArrays: Float32Array[] = new Array(trackCount);
  const fromProgressArrays: Float32Array[] = new Array(trackCount);
  const setters: ((v: number) => void)[] = new Array(trackCount);
  const toProgressArrays: Float32Array[] = new Array(trackCount);
  const valueDeltaArrays: Float32Array[] = new Array(trackCount);
  const fromValueArrays: Float32Array[] = new Array(trackCount);
  const easingArrays: EasingFn[][] = new Array(trackCount);
  const segmentLengths: number[] = new Array(trackCount);
  const lastIndices: number[] = new Array(trackCount);
  const cachedIndices = new Uint32Array(trackCount);

  for (let i = 0; i < trackCount; i++) {
    const { target, segments } = tracks[i];
    const len = segments.length;
    const fromProgress = new Float32Array(len);
    const toProgress = new Float32Array(len);
    const fromValue = new Float32Array(len);
    const rangeInverse = new Float32Array(len);
    const valueDelta = new Float32Array(len);
    const easings: EasingFn[] = new Array(len);

    for (let j = 0; j < len; j++) {
      const seg = segments[j];
      fromProgress[j] = seg.fromProgress;
      toProgress[j] = seg.toProgress;
      fromValue[j] = seg.fromValue;
      rangeInverse[j] = seg.rangeInverse;
      valueDelta[j] = seg.valueDelta;
      easings[j] = seg.easing;
    }

    fromProgressArrays[i] = fromProgress;
    toProgressArrays[i] = toProgress;
    rangeInverseArrays[i] = rangeInverse;
    valueDeltaArrays[i] = valueDelta;
    fromValueArrays[i] = fromValue;
    easingArrays[i] = easings;
    lastIndices[i] = len - 1;
    segmentLengths[i] = len;
    setters[i] = target;
  }

  function render(progress: number) {
    const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;

    for (let i = 0; i < trackCount; i++) {
      const fromProgressArr = fromProgressArrays[i];
      const toProgressArr = toProgressArrays[i];
      const lastIdx = lastIndices[i];

      let idx = cachedIndices[i];
      let fromP = fromProgressArr[idx];
      let toP = toProgressArr[idx];
      const inCached = p >= fromP && (p < toP || (p === 1 && idx === lastIdx));

      if (!inCached) {
        const len = segmentLengths[i];
        if (len <= 4) {
          idx = 0;
          for (let j = lastIdx; j >= 0; j--) {
            if (fromProgressArr[j] <= p) {
              idx = j;
              break;
            }
          }
        }
        else {
          let hi = lastIdx;
          let lo = 0;
          while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (fromProgressArr[mid] <= p) lo = mid;
            else hi = mid - 1;
          }
          idx = lo;
        }
        cachedIndices[i] = idx;
        fromP = fromProgressArr[idx];
      }

      const localProgress = (p - fromP) * rangeInverseArrays[i][idx];
      const mappedProgress = easingArrays[i][idx](localProgress);

      setters[i](fromValueArrays[i][idx] + valueDeltaArrays[i][idx] * mappedProgress);
    }
  }

  return { render };
}
