import { debounce } from '@core/util/debounce';
import { Telemetry } from '@macro-inc/observability';
import {
  eventTimingCursor,
  readEventTimings,
  startUiOperation,
  type UiOperation,
} from './ui-operation';

const SURFACES = new Set([
  'markdown',
  'markdown-sync',
  'chat',
  'plain-text',
  'title',
  'calendar',
  'agent-composer',
  'channel-composer',
  'command-search',
  'grid-cell',
]);
const QUIET_MS = 750;

type Burst = {
  root: HTMLElement;
  operation: UiOperation;
  inputs: number;
  cursor: number;
  start: number;
};

/** One sampled owner for edit bursts; no content, per-key spans or idle loop. */
export function startTypingBurstTelemetry(): () => void {
  if (!Telemetry.config.perfSampled) return () => {};
  let burst: Burst | undefined;
  let key: { event: KeyboardEvent; cursor: number } | undefined;
  const close = debounce(
    (current: Burst) => current.operation.finish(),
    QUIET_MS
  );

  function surface(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return;
    const root = target.closest<HTMLElement>('[data-input-surface]');
    const name = root?.dataset.inputSurface;
    if (!root || !name || !SURFACES.has(name)) return;
    if (
      root instanceof HTMLInputElement ||
      root instanceof HTMLTextAreaElement
    ) {
      if (root.disabled || root.readOnly) return;
    } else if (!root.isContentEditable) return;
    return { root, name };
  }

  function finish(current: Burst) {
    close.clear();
    if (burst === current) burst = undefined;
    const result = readEventTimings(current.cursor);
    const end = performance.now();
    // Focus ends the burst on field changes. Restrict delayed shared entries
    // to this window and keyboard/edit events; pointer activity is unrelated.
    const entries = result.entries.filter(
      (entry) =>
        entry.start >= current.start &&
        entry.start <= end &&
        ['keydown', 'keypress', 'keyup', 'beforeinput', 'input'].includes(
          entry.name
        )
    );
    const interactions = new Map<
      number,
      { inputDelayMs: number; processingMs: number; durationMs: number }
    >();
    let unattributed = 0;
    for (const entry of entries) {
      if (!entry.interactionId) {
        unattributed++;
        continue;
      }
      const previous = interactions.get(entry.interactionId);
      interactions.set(entry.interactionId, {
        inputDelayMs: Math.max(previous?.inputDelayMs ?? 0, entry.inputDelayMs),
        processingMs: Math.max(previous?.processingMs ?? 0, entry.processingMs),
        durationMs: Math.max(previous?.durationMs ?? 0, entry.durationMs),
      });
    }
    const span = current.operation.span;
    span.setAttr('typing.input_count', current.inputs);
    span.setAttr('typing.event_timing_supported', result.supported);
    span.setAttr('typing.event_timing_threshold_ms', result.thresholdMs);
    // The cursor counts every timing kind, so this is not a lost-input count.
    span.setAttr('typing.event_timing_dropped_timings', result.dropped);
    span.setAttr('typing.event_timing_entry_count', entries.length);
    span.setAttr('typing.event_timing_interaction_count', interactions.size);
    span.setAttr('typing.event_timing_unattributed_entry_count', unattributed);
    span.setAttr('typing.event_timing_aggregation', 'max_per_interaction');
    span.setAttr('typing.event_timing_delivery', 'available_at_finish');
    span.setAttr(
      'typing.event_timing_coverage',
      !result.supported
        ? 'unsupported'
        : result.dropped > 0
          ? 'buffer_truncated'
          : 'thresholded_window'
    );
    span.setAttr('typing.quiet_ms', QUIET_MS);
    const values = [...interactions.values()];
    for (const [name, field] of [
      ['input_delay', 'inputDelayMs'],
      ['processing', 'processingMs'],
      ['duration', 'durationMs'],
    ] as const) {
      const sorted = values.map((entry) => entry[field]).sort((a, b) => a - b);
      if (!sorted.length) continue;
      span.setAttr(
        `typing.event_${name}_p50_ms`,
        sorted[Math.ceil(sorted.length * 0.5) - 1]
      );
      span.setAttr(
        `typing.event_${name}_p95_ms`,
        sorted[Math.ceil(sorted.length * 0.95) - 1]
      );
    }
    key = undefined;
  }

  const keydown = (event: KeyboardEvent) => {
    const edits =
      event.key.length === 1 ||
      ['Backspace', 'Delete', 'Enter'].includes(event.key);
    key =
      edits &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      surface(event.target)
        ? { event, cursor: burst?.cursor ?? eventTimingCursor() }
        : undefined;
  };
  const input = (event: InputEvent) => {
    if (document.visibilityState !== 'visible') return;
    const target = surface(event.target);
    if (
      key &&
      (event.timeStamp < key.event.timeStamp ||
        event.timeStamp - key.event.timeStamp > 1000)
    )
      key = undefined;
    if (!target) return;
    if (burst && burst.root !== target.root) burst.operation.finish();
    if (!burst) {
      const first = key?.event.target === event.target ? key.event : event;
      const cursor = key?.cursor ?? eventTimingCursor();
      const relative =
        first.timeStamp > performance.timeOrigin
          ? first.timeStamp - performance.timeOrigin
          : first.timeStamp;
      const now = performance.now();
      const start =
        Number.isFinite(relative) && relative >= 0 && relative <= now
          ? relative
          : now;
      // onFinish also runs on hide, disposal and the shared operation timeout.
      let created: Burst | undefined;
      const operation = startUiOperation('input.typing_burst', {
        event: first,
        attributes: { 'typing.surface': target.name },
        onFinish: () => {
          if (created) finish(created);
        },
      });
      if (operation.ended) return;
      created = {
        root: target.root,
        operation,
        inputs: 0,
        cursor,
        start,
      };
      burst = created;
    }
    const current = burst;
    key = undefined;
    current.inputs++;
    close(current);
  };
  const clearKey = () => {
    key = undefined;
  };
  const focusout = (event: FocusEvent) => {
    if (key?.event.target === event.target) clearKey();
    if (
      burst &&
      event.target instanceof Node &&
      burst.root.contains(event.target) &&
      !(
        event.relatedTarget instanceof Node &&
        burst.root.contains(event.relatedTarget)
      )
    )
      burst.operation.finish();
  };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keyup', clearKey, true);
  document.addEventListener('visibilitychange', clearKey);
  window.addEventListener('pagehide', clearKey);
  document.addEventListener('beforeinput', input, true);
  document.addEventListener('focusout', focusout, true);
  return () => {
    burst?.operation.cancel();
    key = undefined;
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('keyup', clearKey, true);
    document.removeEventListener('visibilitychange', clearKey);
    window.removeEventListener('pagehide', clearKey);
    document.removeEventListener('beforeinput', input, true);
    document.removeEventListener('focusout', focusout, true);
  };
}
