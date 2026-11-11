import { NOOP_SPAN, type Span, Telemetry } from '@macro-inc/observability';
import type { EditorView } from './editor-view';

/** No content reads, layout measurements or observers on the edit path. */
export function editorPerformanceAttributes(view: EditorView) {
  return {
    'editor.namespace': view.options.namespace,
    'editor.model.node_count': view.mirror.size,
    'editor.document.block_count': view.node(0)?.children.length ?? 0,
    'editor.document.text_code_units': view.mirror.textLength,
    'editor.dom.keyed_node_count': view.keyedDOMNodeCount,
    'editor.decorator_count': view.decoratorCount,
  };
}

const UNSAMPLED = { span: NOOP_SPAN, finish: (_outcome: string) => {} };

export interface EditorPerformanceOperation {
  readonly span: Span;
  finish(outcome: string): void;
}

/** The host adds shared browser timings; the view never installs another observer. */
export function startEditorPerformance(
  view: EditorView,
  name: 'editor.paste' | 'editor.reconcile'
) {
  if (!Telemetry.config.sampled('perf')) return UNSAMPLED;
  const start = performance.now();
  const operation = view.options.startPerformance?.(name);
  const span = operation?.span ?? Telemetry.span(name, { sampling: 'perf' });
  let ended = false;
  return {
    span,
    finish(outcome: string) {
      if (ended) return;
      ended = true;
      const end = performance.now();
      try {
        for (const [key, value] of Object.entries(
          editorPerformanceAttributes(view)
        ))
          span.setAttr(key, value);
        span.setAttr('editor.outcome', outcome);
        span.setAttr('editor.elapsed_ms', end - start);
      } finally {
        if (operation) operation.finish(outcome);
        else span.end();
      }
    },
  };
}
