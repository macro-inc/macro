import type { RoutineEntity } from '@entity/types/entity';
import type { Accessor } from 'solid-js';
import type { ScheduleDraft } from '../core/draft';
import type { HistoryRecord } from '../core/history';
import type { RoutineSnapshot } from '../core/routine';

export type RoutineDetailSource = {
  routine: Accessor<RoutineSnapshot | undefined>;
  entity: Accessor<RoutineEntity | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
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
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  refresh(): Promise<unknown>;
  setEnabled(id: string, enabled: boolean): void;
  pendingId: Accessor<string | undefined>;
};
