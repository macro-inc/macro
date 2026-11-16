import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Accessor } from 'solid-js';
import type { RoutineRowMenuActions } from '../components/routine-row-menu';
import {
  type RoutinesDiscover,
  RoutinesList,
} from '../components/routines-list';
import type { RoutineListSource } from '../context/routine-sources';
import type { RoutineTemplate } from '../core/routine-templates';
import { createRoutineRows } from '../primitives/routines-list';

export function RoutinesListView(props: {
  source: RoutineListSource;
  userId: Accessor<string | undefined>;
  showTitle?: boolean;
  registerSearchFocus?: (focus: () => void) => void;
  onCreate(): void;
  onOpen(id: string): void;
  /** Templates to start from, above the list. */
  templates?: RoutineTemplate[];
  onTemplate?: (template: RoutineTemplate) => void;
  /** Suggestions: a row above the list and the Discover tab. */
  discover?: RoutinesDiscover;
  /** What each row's context menu does; absent where rows have none. */
  menu?: RoutineRowMenuActions;
}) {
  // A phone lists top-level routines only; what they created is on their pages.
  const rows = createRoutineRows(
    props.source,
    props.userId,
    () => !isTouchDevice()
  );
  return (
    <RoutinesList
      showTitle={props.showTitle}
      registerSearchFocus={props.registerSearchFocus}
      rows={rows()}
      loading={props.source.loading()}
      error={props.source.error()}
      onRetry={() => fireAndForget(props.source.refresh(), 'routines')}
      onCreate={props.onCreate}
      onOpen={props.onOpen}
      pendingId={props.source.pendingId()}
      onToggle={(row) => props.source.setEnabled(row.id, !row.enabled)}
      templates={props.templates}
      onTemplate={props.onTemplate}
      discover={props.discover}
      menu={props.menu}
    />
  );
}
