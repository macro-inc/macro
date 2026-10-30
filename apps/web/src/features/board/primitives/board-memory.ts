import { makePersistedState } from '@app/lib/persistence';
import { createStore, produce } from 'solid-js/store';
import { z } from 'zod';
import type { BoardStorage } from '../context/board-context';
import type { Camera, Point } from '../core/camera';
import type { BoardRecall } from '../core/lifecycle';
import type { BoardVariant } from '../core/variants';

const pointSchema = z.object({ x: z.number(), y: z.number() });

const memorySchema = z.object({
  version: z.literal(1),
  recall: z.record(
    z.string(),
    z.object({
      dismissedAt: z.number().optional(),
      seenAt: z.number().optional(),
      pinned: z.boolean().optional(),
    })
  ),
  positions: z.record(z.string(), z.record(z.string(), pointSchema)),
  cameras: z.record(
    z.string(),
    z.object({ x: z.number(), y: z.number(), scale: z.number() })
  ),
  showSettled: z.boolean(),
});

export type BoardMemoryState = z.infer<typeof memorySchema>;

const EMPTY_MEMORY: BoardMemoryState = {
  version: 1,
  recall: {},
  positions: {},
  cameras: {},
  showSettled: false,
};

/** Entries kept per map; the oldest go first. */
const MAX_ENTRIES = 400;

const recallTime = (recall: BoardRecall) =>
  Math.max(recall.dismissedAt ?? 0, recall.seenAt ?? 0);

/**
 * Bounds what a long-lived board stores: items moved by hand first, since
 * their positions depend on it, then the newest recall; positions only for
 * remembered items.
 */
export function pruneMemory(state: BoardMemoryState): BoardMemoryState {
  const recall = Object.fromEntries(
    Object.entries(state.recall)
      .sort(
        ([, a], [, b]) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          recallTime(b) - recallTime(a)
      )
      .slice(0, MAX_ENTRIES)
  );
  const positions = Object.fromEntries(
    Object.entries(state.positions).map(([variant, points]) => [
      variant,
      Object.fromEntries(
        Object.entries(points)
          .filter(([key]) => recall[key]?.pinned)
          .slice(-MAX_ENTRIES)
      ),
    ])
  );
  return { ...state, recall, positions };
}

/**
 * What the board remembers for the viewer across visits: which items they
 * closed or opened, where they moved them, each variant's camera, and
 * whether settled items show.
 */
export function createBoardMemory(storage: BoardStorage) {
  const [state, setState] = makePersistedState(
    createStore<BoardMemoryState>(structuredClone(EMPTY_MEMORY)),
    {
      storages: {
        restore: () => {
          const parsed = memorySchema.safeParse(storage.read());
          return parsed.success ? parsed.data : undefined;
        },
        write: (value) => storage.write(pruneMemory(value)),
      },
    }
  );

  const updateRecall = (key: string, patch: BoardRecall) =>
    setState(
      'recall',
      produce((recall) => {
        recall[key] = { ...recall[key], ...patch };
      })
    );

  return {
    recall: (key: string): BoardRecall | undefined => state.recall[key],
    position: (variant: BoardVariant, key: string): Point | undefined =>
      state.positions[variant]?.[key],
    camera: (variant: BoardVariant): Camera | undefined =>
      state.cameras[variant],
    showSettled: () => state.showSettled,
    hasMoved: (variant: BoardVariant) =>
      Object.keys(state.positions[variant] ?? {}).length > 0,

    /** Closes an item until something newer than `activityAt` happens in it. */
    dismiss(key: string, activityAt: number) {
      setState(
        produce((draft) => {
          draft.recall[key] = {
            ...draft.recall[key],
            dismissedAt: activityAt,
            pinned: false,
          };
          for (const points of Object.values(draft.positions)) {
            delete points[key];
          }
        })
      );
    },
    markSeen(key: string, at: number) {
      updateRecall(key, { seenAt: at });
    },
    moveTo(variant: BoardVariant, key: string, point: Point) {
      setState(
        produce((draft) => {
          draft.positions[variant] = {
            ...draft.positions[variant],
            [key]: { x: Math.round(point.x), y: Math.round(point.y) },
          };
          draft.recall[key] = { ...draft.recall[key], pinned: true };
        })
      );
    },
    /** Remembers where the viewer left a variant's camera; none means fit. */
    setCamera(variant: BoardVariant, camera: Camera | undefined) {
      setState(
        'cameras',
        produce((cameras) => {
          if (camera) cameras[variant] = { ...camera };
          else delete cameras[variant];
        })
      );
    },
    setShowSettled(show: boolean) {
      setState('showSettled', show);
    },
    /** Puts every item this variant has moved back into its layout. */
    tidy(variant: BoardVariant) {
      setState(
        produce((draft) => {
          const moved = Object.keys(draft.positions[variant] ?? {});
          draft.positions[variant] = {};
          for (const key of moved) {
            const stillPinned = Object.values(draft.positions).some(
              (points) => key in points
            );
            if (!stillPinned && draft.recall[key]) {
              draft.recall[key] = { ...draft.recall[key], pinned: false };
            }
          }
        })
      );
    },
  };
}

export type BoardMemory = ReturnType<typeof createBoardMemory>;
