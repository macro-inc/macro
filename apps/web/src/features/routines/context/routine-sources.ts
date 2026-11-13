import type { RoutineEntity } from '@entity/types/entity';
import type { Accessor } from 'solid-js';
import type { CodeReview } from '../core/code-review';
import type { ScheduleDraft } from '../core/draft';
import type { HistoryRecord } from '../core/history';
import type { RoutineSnapshot } from '../core/routine';

export type RoutineDetailSource = {
  routine: Accessor<RoutineSnapshot | undefined>;
  entity: Accessor<RoutineEntity | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  /**
   * The server won't read this routine to the viewer, which it does only for
   * its owner: it is someone else's routine (or gone).
   */
  readRefused: Accessor<boolean>;
  update(draft: ScheduleDraft): Promise<RoutineSnapshot>;
  run(): void;
  runPending: Accessor<boolean>;
  setEnabled(enabled: boolean): void;
  activationPending: Accessor<boolean>;
  duplicate(): void;
  duplicationPending: Accessor<boolean>;
  history: Accessor<HistoryRecord[]>;
  historyLoading: Accessor<boolean>;
  historyError: Accessor<boolean>;
  refreshHistory(): Promise<unknown>;
  /** The routine is paused until its owner reviews its code for a new SDK. */
  codeReview: Accessor<CodeReview | undefined>;
  /** Save the proposed code update and resume the routine. */
  approveCodeUpdate(): Promise<void>;
  codeUpdatePending: Accessor<boolean>;
  /** The routines this routine's runs created, finished ones included. */
  subRoutines: Accessor<readonly RoutineSnapshot[]>;
  /** The routine whose run created this one, when it is still there. */
  parent: Accessor<{ id: string; name: string } | undefined>;
  /** Make this sub-routine the owner's own: it stops following its parent. */
  keepAsOwn(): void;
  keepAsOwnPending: Accessor<boolean>;
};
export type RoutineCreatorSource = {
  pending: Accessor<boolean>;
  create(draft: ScheduleDraft): Promise<string>;
};
export type RoutineDraftStorage = {
  load(): ScheduleDraft | null;
  save(draft: ScheduleDraft): void;
  clear(): void;
};
export type RoutineListSource = {
  routines: Accessor<readonly RoutineSnapshot[]>;
  /** Every routine another routine's run created, to nest under it. */
  subRoutines: Accessor<readonly RoutineSnapshot[]>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  refresh(): Promise<unknown>;
  setEnabled(id: string, enabled: boolean): void;
  pendingId: Accessor<string | undefined>;
};
