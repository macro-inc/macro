import type { Accessor } from 'solid-js';
import { RoutinesList } from '../components/routines-list';
import type { RoutineListSource } from '../context/routine-sources';
import type { RoutineTarget } from '../core/routine-target';
import { createRoutineRows } from '../primitives/routines-list';

export function RoutinesListView(props: {
  source: RoutineListSource;
  userId: Accessor<string | undefined>;
  targetLabel(target: RoutineTarget): string;
  searchRef(input: HTMLInputElement): void;
  onCreate(): void;
  onOpen(id: string): void;
}) {
  const rows = createRoutineRows(props.source, props.userId, props.targetLabel);
  return (
    <RoutinesList
      searchRef={props.searchRef}
      rows={rows()}
      loading={props.source.loading()}
      error={props.source.error()}
      onRetry={() => void props.source.refresh()}
      onCreate={props.onCreate}
      onOpen={props.onOpen}
      pendingId={props.source.pendingId()}
      onToggle={(row) => props.source.setEnabled(row.id, !row.enabled)}
    />
  );
}
