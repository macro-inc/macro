import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { editorPerformanceAttributes } from '@macro-inc/lexical-wasm-view/view/performance';
import { type Span, Telemetry } from '@macro-inc/observability';
import { debounce } from '../lib/core/util/debounce';
import {
  blockingWorkBetween,
  startUiOperation,
  type UiOperation,
} from './ui-operation';

/** Reuse the app's bounded observer; these are overlapping work, not causal CPU. */
function recordEditorBlockingWork(span: Span, start: number, end: number) {
  const work = blockingWorkBetween(start, end);
  const supported =
    typeof PerformanceObserver === 'undefined'
      ? []
      : (PerformanceObserver.supportedEntryTypes ?? []);
  span.setAttr('editor.long_task.supported', supported.includes('longtask'));
  span.setAttr(
    'editor.long_animation_frame.supported',
    supported.includes('long-animation-frame')
  );
  span.setAttr('editor.blocking_work.coverage', 'bounded_recent_entries');
  if (supported.includes('longtask')) {
    span.setAttr('editor.long_task.count', work.longTaskCount);
    span.setAttr('editor.long_task.overlap_ms', work.longTaskMs);
  }
  if (supported.includes('long-animation-frame')) {
    span.setAttr(
      'editor.long_animation_frame.count',
      work.longAnimationFrameCount
    );
    span.setAttr(
      'editor.long_animation_frame.overlap_ms',
      work.longAnimationFrameMs
    );
    span.setAttr(
      'editor.long_animation_frame.blocking_ms',
      work.longAnimationFrameBlockingMs
    );
  }
}

/** Finish after paint so the shared observer can deliver the task that just ran. */
export function startEditorOperation(
  name: 'editor.paste' | 'editor.reconcile',
  documentId: string
) {
  const start = performance.now();
  const operation = startUiOperation(name, {
    attributes: { 'document.id': documentId, 'editor.engine': 'rust' },
    onFinish(span, _outcome, end) {
      recordEditorBlockingWork(span, start, end);
    },
  });
  return {
    span: operation.span,
    finish(outcome: string) {
      if (outcome === 'success' || outcome === 'unhandled')
        operation.afterPaint();
      else if (outcome === 'error') operation.finish('error');
      else operation.cancel();
    },
  };
}

/** Scroll-only frame sampling, bounded to one second and 240 intervals per span. */
export function startEditorScrollTelemetry(
  view: EditorView,
  documentId: string
): () => void {
  if (!Telemetry.config.sampled('perf')) return () => {};
  const root = view.root;
  const doc = root.ownerDocument;
  const window = doc.defaultView;
  if (!window) return () => {};
  let current:
    | {
        operation: UiOperation;
        frames: number[];
        dropped: number;
        last: number | undefined;
        scrolls: number;
      }
    | undefined;
  let frame: number | undefined;
  const quiet = debounce(() => current?.operation.finish(), 180);
  let limit: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    if (frame !== undefined) window?.cancelAnimationFrame(frame);
    quiet.clear();
    clearTimeout(limit);
    frame = undefined;
    current = undefined;
  }
  function tick(time: number) {
    if (!current) return;
    if (current.last !== undefined) {
      if (current.frames.length < 240) current.frames.push(time - current.last);
      else current.dropped++;
    }
    current.last = time;
    frame = window?.requestAnimationFrame(tick);
  }
  function scroll(event: Event) {
    if (
      doc.hidden ||
      !(event.target instanceof Node) ||
      !event.target.contains(root)
    )
      return;
    if (!current) {
      const frames: number[] = [];
      const start = performance.now();
      const operation = startUiOperation('editor.scroll', {
        event,
        attributes: { 'document.id': documentId, 'editor.engine': 'rust' },
        onFinish(span, _outcome, end) {
          const sample = current;
          if (!sample) return;
          recordEditorBlockingWork(span, start, end);
          for (const [key, value] of Object.entries(
            editorPerformanceAttributes(view)
          ))
            span.setAttr(key, value);
          span.setAttr('editor.scroll.event_count', sample.scrolls);
          span.setAttr('editor.frame.count', frames.length);
          span.setAttr('editor.frame.dropped_count', sample.dropped);
          span.setAttr('editor.frame.budget_ms', 1000 / 60);
          span.setAttr('editor.frame.tolerance_ms', 0.5);
          span.setAttr(
            'editor.frame.over_budget_count',
            frames.filter((ms) => ms > 1000 / 60 + 0.5).length
          );
          span.setAttr(
            'editor.frame.jank_count',
            frames.filter((ms) => ms > 1000 / 30 + 0.5).length
          );
          if (frames.length) {
            frames.sort((a, b) => a - b);
            span.setAttr(
              'editor.frame.p95_ms',
              frames[Math.ceil(frames.length * 0.95) - 1]
            );
            span.setAttr('editor.frame.max_ms', frames[frames.length - 1]);
          }
          clear();
        },
      });
      if (operation.ended) return;
      current = { operation, frames, dropped: 0, last: undefined, scrolls: 0 };
      frame = window?.requestAnimationFrame(tick);
      limit = setTimeout(() => current?.operation.finish(), 1000);
    }
    current.scrolls++;
    quiet();
  }
  doc.addEventListener('scroll', scroll, { capture: true, passive: true });
  return () => {
    current?.operation.cancel();
    clear();
    doc.removeEventListener('scroll', scroll, true);
  };
}
