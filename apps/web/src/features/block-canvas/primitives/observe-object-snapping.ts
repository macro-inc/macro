import type { GraphicsEditor, ObjectSnapStats } from '@macro-inc/graphics';
import { Telemetry } from '@macro-inc/observability';
import { onCleanup } from 'solid-js';

/** One trace per gesture, with aggregate query work rather than per-pointer spans. */
export function observeObjectSnapping(
  editor: GraphicsEditor,
  documentId: string
) {
  let span: ReturnType<typeof Telemetry.span> | undefined;
  let stats: ObjectSnapStats | undefined;
  let snappedUpdates = 0;
  let initial = editor.document;
  const finish = () => {
    if (!span) return;
    span.setAttr('snap.targets', stats?.targets ?? 0);
    span.setAttr('snap.queries', stats?.queries ?? 0);
    span.setAttr('snap.candidates', stats?.candidates ?? 0);
    span.setAttr('snap.index_nodes_visited', stats?.visited ?? 0);
    span.setAttr('snap.snapped_updates', snappedUpdates);
    span.setAttr(
      'outcome',
      editor.document === initial ? 'cancelled' : 'committed'
    );
    span.end();
    span = undefined;
  };
  onCleanup(
    editor.subscribeSession((session) => {
      const transform = session.transform;
      if (!transform?.snapStats) {
        finish();
        return;
      }
      if (!span) {
        span = Telemetry.span('canvas.object_snap');
        span.setAttr('document.id', documentId);
        span.setAttr('transform.kind', transform.kind);
        initial = editor.document;
        snappedUpdates = 0;
      }
      stats = transform.snapStats;
      if (transform.snapGuides.length) snappedUpdates++;
    })
  );
  onCleanup(finish);
}
