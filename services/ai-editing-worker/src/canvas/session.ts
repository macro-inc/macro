import { schema } from '@loro-mirror/core';
import { createAwareness } from '@macro-inc/collaboration/collab/awareness';
import { SyncEngine } from '@macro-inc/collaboration/collab/engine';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  type InitialSync,
  type LiveSyncSource,
  type SyncError,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import {
  InMemoryWALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { TextFitEffect, TextFitResult } from '@macro-inc/graphics';
import {
  type GraphicsDocument,
  worldBounds,
  worldMatrix,
} from '@macro-inc/graphics';
import {
  createLoroGraphicsBackendFromDoc,
  type PeerPresence,
} from '@macro-inc/graphics/loro';
import {
  richTextPlainText,
  validCanvasText,
} from '@macro-inc/lexical-core/canvas-text';
import { Telemetry } from '@macro-inc/observability';
import type { ResultAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import {
  type CanvasPresentation,
  canvasAnimation,
  runCanvasAnimation,
} from './animation';
import { CanvasScheduler, dependencies, dependencyState } from './dependencies';
import { canvasUserMentions } from './mentions';
import { prepareCanvasEdit } from './operations';
import { canvasOverview } from './overview';
import type { CanvasMeasurer, CanvasSnapshot } from './render';
import type { CanvasOp } from './schema';
import { applyTextMeasurements, textFitRequests } from './text-layout';

export type CanvasSource = LiveSyncSource & {
  doInitialSync(): ResultAsync<InitialSync, SyncError>;
};

/** A committed update may already have reached peers; never replay its intent. */
export class CanvasWriteError extends Error {}
export class CanvasConflictError extends Error {}
export type CanvasApplyOptions = {
  baseline?: GraphicsDocument;
  present?: (value: CanvasPresentation | undefined) => void;
  animate?: boolean;
  sleep?: (ms: number) => Promise<void>;
  measure?: CanvasMeasurer;
};
export type CanvasSession = {
  read: (itemIds?: string[], format?: 'scene' | 'overview') => string;
  snapshot: () => CanvasSnapshot;
  present: (value: CanvasPresentation | undefined) => void;
  watching: () => boolean;
  apply: (
    ops: CanvasOp[],
    options?: CanvasApplyOptions
  ) => Promise<{
    operationsApplied: number;
    canvas: string;
    textLayout: TextFitEffect[];
  }>;
};

/** Open only the server's winning seed, never independently seed a live room. */
export async function withCanvasSession<T>(
  source: CanvasSource,
  signal: AbortSignal,
  run: (session: CanvasSession) => Promise<T>,
  editorName = 'Macro'
): Promise<T> {
  const manager = new LoroManager(schema({}), {
    documentId: source.documentId,
    // The graphics backend owns the typed scene Mirror on this same document.
    mirror: false,
  });
  let lastAppend = Promise.resolve();
  class CanvasWAL extends WALSyncer<Uint8Array> {
    override append(update: Uint8Array): Promise<void> {
      const previous = lastAppend;
      const work = super.append(update);
      lastAppend = Promise.all([previous, work]).then(() => {});
      return lastAppend;
    }
  }
  const wal = new CanvasWAL(new InMemoryWALStore<Uint8Array>(), (updates) =>
    source.pushUpdate(updates)
  );
  let engine: { stop(): void } | undefined;
  let disposeBackend = () => {};
  let stopManager = () => {};
  let stopPresence = () => {};
  let clearPresence = () => {};
  try {
    signal.throwIfAborted();
    const initial = await Telemetry.span(
      'canvas.ai.sync_init',
      async () => await source.doInitialSync()
    );
    if (initial.isErr())
      throw new Error(
        `Canvas initial sync failed (${initial.error.type}; connection: ${SyncSourceStatus[source.status()]}). No scene was loaded or edited. Check shared storage initialization and sync connectivity before retrying.`
      );
    const loaded = await manager.initializeFromSnapshot(initial.value.snapshot);
    if (loaded.isErr()) throw new Error('Invalid canvas snapshot.');
    const doc = manager.doc;
    const meta = doc.getMap('canvasMeta');
    const rootId = meta.get('rootId');
    if (meta.get('format') !== 1 || typeof rootId !== 'string')
      throw new Error(
        'Shared storage does not contain a supported Canvas snapshot. No scene was edited.'
      );
    // Full-width random session IDs cannot collide across worker isolates.
    // Durable bot attribution comes from the signed actor, not this peer range.
    const peer = manager.peerId;
    source.registerPeerId(peer);
    const backend = createLoroGraphicsBackendFromDoc(
      doc,
      rootId,
      () => !signal.aborted && manager.doc === doc
    );
    disposeBackend = backend.dispose;
    const awareness = createRoot((dispose) => {
      stopPresence = dispose;
      return createAwareness<string, PeerPresence | null>(
        doc.peerIdStr,
        undefined,
        {
          encode: JSON.stringify,
          decode: (value) => {
            try {
              const parsed: unknown = JSON.parse(value);
              if (
                !parsed ||
                typeof parsed !== 'object' ||
                !('name' in parsed) ||
                typeof parsed.name !== 'string'
              )
                return null;
              return {
                id: '',
                name: parsed.name,
                color: '',
                cursor: null,
                selectedIds: [],
                clock: {},
                preview: null,
                reducedMotion:
                  'reducedMotion' in parsed && parsed.reducedMotion === true,
              };
            } catch {
              return null;
            }
          },
        }
      );
    });
    const activeEngine = new SyncEngine({
      loroManager: manager,
      awareness,
      syncs: { wal, live: source },
      bindings: { onRemoteState: () => {} },
    });
    engine = activeEngine;
    if (initial.value.awareness.length)
      awareness.importRemoteAwareness(initial.value.awareness);
    stopManager = manager.onStateChange((state) =>
      queueMicrotask(() => activeEngine.onStateUpdate(state))
    );
    activeEngine.start();
    clearPresence = () => {
      awareness.updateLocalAwareness(undefined);
      activeEngine.onLocalAwarenessChange();
    };
    const check = () => {
      signal.throwIfAborted();
      if (manager.doc !== doc)
        throw new Error(
          'Canvas reconnected with a replacement snapshot. Read the canvas before retrying; earlier edits may have applied.'
        );
    };
    const read = (
      itemIds?: string[],
      format: 'scene' | 'overview' = 'scene'
    ) => {
      check();
      return format === 'overview'
        ? JSON.stringify(canvasOverview(backend.getDocument(), itemIds))
        : describeCanvas(backend.getDocument(), itemIds);
    };
    const present = (value: CanvasPresentation | undefined) => {
      if (!value) {
        clearPresence();
        return;
      }
      awareness.updateLocalAwareness({
        ...value,
        id: doc.peerIdStr,
        name: `${editorName.replace(/\s*\(AI\)$/, '').slice(0, 180)} (AI)`,
        color: 'cyan',
        clock: backend.getClock(),
      });
      activeEngine.onLocalAwarenessChange();
    };
    const scheduler = new CanvasScheduler();
    let pendingCommit = Promise.resolve();
    const watching = () =>
      awareness
        .remote()
        .some(
          (peer) =>
            peer.selection &&
            !peer.selection.name.endsWith('(AI)') &&
            !peer.selection.reducedMotion
        );
    const result = await run({
      read,
      present,
      watching,
      snapshot: () => {
        check();
        return {
          documentId: source.documentId,
          document: structuredClone(backend.getDocument()),
          clock: { ...backend.getClock() },
        };
      },
      async apply(ops, options = {}) {
        check();
        const baseline = options.baseline ?? backend.getDocument();
        let planned = await Telemetry.span(
          'canvas.ai.validate',
          async (span) => {
            span.setAttr('edit.ops_total', ops.length);
            return prepareCanvasEdit(baseline, ops);
          }
        );
        const requests = textFitRequests(baseline, planned, ops);
        let measured: TextFitResult | undefined;
        if (options.measure && requests.length) {
          measured = await options.measure(
            {
              documentId: source.documentId,
              document: planned,
              clock: { ...backend.getClock() },
            },
            requests,
            signal
          );
          planned = measured.document;
        }
        const deps = dependencies(baseline, planned, ops);
        const expected = dependencyState(baseline, deps);
        const validate = () => {
          check();
          if (dependencyState(backend.getDocument(), deps) !== expected)
            throw new CanvasConflictError(
              'Canvas targets or reserved space changed. ReadCanvas and replan this batch; nothing from this batch was committed.'
            );
        };
        const queued = performance.now();
        return scheduler.run(deps, async () => {
          await Telemetry.span('canvas.ai.schedule', async (span) => {
            span.setAttr('canvas.schedule.wait_ms', performance.now() - queued);
            span.setAttr('canvas.schedule.targets', deps.writes.size);
          });
          validate();
          const show = options.present ?? present;
          try {
            if (options.animate ?? watching())
              await Telemetry.span('canvas.ai.animate', async () =>
                runCanvasAnimation(
                  canvasAnimation(baseline, planned, deps),
                  show,
                  signal,
                  validate,
                  options.sleep
                )
              );
            const commit = async () => {
              check();
              // A peer's ACK can precede delivery on this socket. Pull a server
              // barrier after presentation so already-accepted human changes are
              // included in final dependency validation, even if live delivery lags.
              await Telemetry.span('canvas.ai.revalidate', async () => {
                const updates = await source.requestUpdatesSince(
                  manager.version
                );
                check();
                if (
                  updates.isErr() ||
                  manager.importUpdate(updates.value).isErr()
                )
                  throw new CanvasConflictError(
                    'Canvas could not refresh current targets. ReadCanvas and replan; nothing from this batch was committed.'
                  );
              });
              validate();
              // Rebuild against fresh canonical state; unrelated human/AI changes survive.
              const fresh = prepareCanvasEdit(backend.getDocument(), ops);
              const next = measured
                ? applyTextMeasurements(fresh, measured)
                : fresh;
              check();
              const selectedIds = [
                ...new Set(
                  ops.flatMap((op) => ('ids' in op ? op.ids : [op.id]))
                ),
              ]
                .filter((id) => next.items[id])
                .slice(0, 100);
              const first = selectedIds[0];
              const bounds = first ? worldBounds(next, first) : undefined;
              show({
                cursor: bounds ? { x: bounds.x, y: bounds.y } : null,
                selectedIds,
                preview: null,
              });
              await Telemetry.span('canvas.ai.apply', async (span) => {
                span.setAttr('edit.ops_total', ops.length);
                span.setAttr(
                  'edit.user_mentions',
                  ops.filter((op) => op.kind === 'mentionUser').length
                );
                backend.commit(next);
                try {
                  await lastAppend;
                  await wal.flush();
                  if ((await wal.summary()).dirty)
                    throw new Error('Canvas write acknowledgement was lost.');
                } catch {
                  throw new CanvasWriteError(
                    'Canvas write acknowledgement was lost. Read the canvas before retrying; the edit may have applied.'
                  );
                }
              });
              return {
                operationsApplied: ops.length,
                canvas: read(),
                textLayout: measured?.effects ?? [],
              };
            };
            const result = pendingCommit.then(commit);
            pendingCommit = result.then(
              () => {},
              () => {}
            );
            return await result;
          } finally {
            show(undefined);
          }
        });
      },
    });
    await Telemetry.span('canvas.ai.flush', async () => {
      await lastAppend;
      await wal.flush();
      if ((await wal.summary()).dirty)
        throw new Error(
          'Canvas edits were not acknowledged. Read the canvas before retrying.'
        );
    });
    return result;
  } finally {
    clearPresence();
    stopPresence();
    stopManager();
    engine?.stop();
    disposeBackend();
    wal.destroy();
    manager.dispose();
    source.cleanup();
  }
}

/** Bounded scene inspection includes stable IDs, local/world geometry and order. */
export function describeCanvas(
  document: GraphicsDocument,
  itemIds?: string[]
): string {
  const all = Object.values(document.items).filter(
    (item) => item.type !== 'surface'
  );
  const selected = itemIds
    ? all.filter((item) => itemIds.includes(item.id))
    : all;
  const items = selected.slice(0, 300).map((item) => {
    const content =
      item.type === 'text'
        ? item.geometry.content
        : 'geometry' in item && 'label' in item.geometry
          ? item.geometry.label?.content
          : undefined;
    const plainText =
      content && validCanvasText(content)
        ? richTextPlainText(content)
        : undefined;
    const userMentions =
      content && plainText !== undefined
        ? canvasUserMentions(content)
        : { mentions: [], incomplete: false };
    return {
      ...item,
      text: plainText?.slice(0, 2000),
      userMentions: userMentions.mentions,
      userMentionsTruncated: userMentions.incomplete,
      textTruncated: (plainText?.length ?? 0) > 2000,
      pointsTruncated:
        item.type === 'pencil' && item.geometry.points.length > 64,
      world: worldMatrix(document, item.id),
      bounds: worldBounds(document, item.id),
    };
  });
  const text = JSON.stringify(
    {
      rootId: document.rootId,
      totalItems: all.length,
      matchedItems: selected.length,
      truncated:
        selected.length > 300 ||
        items.some(
          (item) =>
            item.textTruncated ||
            item.pointsTruncated ||
            item.userMentionsTruncated
        ),
      items,
    },
    (key, value: unknown) =>
      key === 'content'
        ? undefined
        : key === 'points' && Array.isArray(value)
          ? value.slice(0, 64)
          : value
  );
  if (text.length > 500_000)
    throw new Error(
      'Canvas too large for AI inspection. Reduce its content before editing.'
    );
  return text;
}
