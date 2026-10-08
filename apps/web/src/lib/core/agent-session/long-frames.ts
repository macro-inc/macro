/**
 * Long animation frames (the Long Animation Frames API) seen while a span
 * waited for something to paint: the main-thread work a person sat through
 * that no request timing shows. Feature-detected; absent where unsupported.
 */

/**
 * The fields of a `long-animation-frame` entry read here. Typed locally:
 * the DOM lib does not carry them yet.
 */
type LongFrame = PerformanceEntry & {
  blockingDuration: number;
  scripts: readonly {
    duration: number;
    invoker: string;
    sourceURL: string;
  }[];
};

export type LongFrameWatch = {
  /** Every frame seen so far, including those not yet delivered. */
  take: () => readonly LongFrame[];
  stop: () => void;
};

/**
 * Collect long animation frames (50ms+) from now until `stop`. Undefined
 * where the browser has no Long Animation Frames API.
 */
export function observeLongFrames(): LongFrameWatch | undefined {
  try {
    if (
      typeof PerformanceObserver === 'undefined' ||
      !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')
    ) {
      return undefined;
    }
    const frames: LongFrame[] = [];
    const collect = (entries: PerformanceEntryList) => {
      // Entries of the observed type carry the fields `LongFrame` reads.
      for (const entry of entries) frames.push(entry as LongFrame);
    };
    const observer = new PerformanceObserver((list) =>
      collect(list.getEntries())
    );
    observer.observe({ type: 'long-animation-frame' });
    let stopped = false;
    return {
      take: () => {
        if (!stopped) collect(observer.takeRecords());
        return frames;
      },
      stop: () => {
        if (stopped) return;
        collect(observer.takeRecords());
        stopped = true;
        observer.disconnect();
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * How long a frame's entry may take to reach the observer after the frame:
 * the browser queues it once the frame has painted, so a paint observed
 * by animation frame comes before the entry describing it.
 */
const ENTRY_DELAY_MS = 100;

/**
 * Calls `then` once the frames up to now have reached `watch`: at once
 * without one, otherwise after {@link ENTRY_DELAY_MS}.
 */
export function afterLongFrames(
  watch: LongFrameWatch | undefined,
  then: () => void
): void {
  if (!watch) {
    then();
    return;
  }
  setTimeout(then, ENTRY_DELAY_MS);
}

/** Longest a script attribution may be on a span. */
const SCRIPT_ATTRIBUTION_MAX = 200;

/**
 * The long frames that overlap `[from, to]`, as `<prefix>.loaf_*`
 * attributes: how many, how long, how much of that blocked input, and the
 * script that held the longest one.
 */
export function summarizeFrames(
  watch: LongFrameWatch | undefined,
  prefix: string,
  from: number,
  to: number
): Record<string, number | string> {
  if (!watch) return {};
  const frames = watch
    .take()
    .filter(
      (frame) => frame.startTime < to && frame.startTime + frame.duration > from
    );
  let total = 0;
  let blocking = 0;
  let longest: LongFrame | undefined;
  for (const frame of frames) {
    total += frame.duration;
    blocking += frame.blockingDuration;
    if (!longest || frame.duration > longest.duration) longest = frame;
  }
  const summary: Record<string, number | string> = {
    [`${prefix}.loaf_count`]: frames.length,
    [`${prefix}.loaf_total_ms`]: Math.round(total),
    [`${prefix}.loaf_max_ms`]: Math.round(longest?.duration ?? 0),
    [`${prefix}.loaf_blocking_ms`]: Math.round(blocking),
  };
  const script = longest?.scripts.reduce<
    LongFrame['scripts'][number] | undefined
  >(
    (top, script) => (!top || script.duration > top.duration ? script : top),
    undefined
  );
  if (script) {
    summary[`${prefix}.loaf_top_script_source`] = script.sourceURL.slice(
      0,
      SCRIPT_ATTRIBUTION_MAX
    );
    summary[`${prefix}.loaf_top_script_invoker`] = script.invoker.slice(
      0,
      SCRIPT_ATTRIBUTION_MAX
    );
    summary[`${prefix}.loaf_top_script_ms`] = Math.round(script.duration);
  }
  return summary;
}
