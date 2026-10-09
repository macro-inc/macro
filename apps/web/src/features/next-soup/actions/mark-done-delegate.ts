import type { EntityData } from '@entity';

/**
 * A list that completes its own rows. Home's work feed marks items done as
 * feed items — acknowledging the notifications each row showed, scoped to
 * that row (a channel without its threads) — rather than per entity.
 */
export type MarkDoneDelegate = {
  /**
   * Whether one of the delegate's rows can be completed, or undefined when
   * the entity is not one of its rows. A row with nothing to acknowledge,
   * such as the viewer's own recent work, cannot.
   */
  canComplete: (entity: EntityData) => boolean | undefined;
  /**
   * Prepare completing `entities`, or return undefined when any of them is
   * not one of the delegate's rows; the entity path then runs instead.
   */
  prepare: (entities: readonly EntityData[]) => PreparedMarkDone | undefined;
};

export type PreparedMarkDone = {
  /** Hide the rows now; returns a function that shows them again. */
  hide: () => () => void;
  /** Complete the rows; resolves to the function that reverses exactly this. */
  commit: () => Promise<{ undo: () => Promise<void> }>;
};
