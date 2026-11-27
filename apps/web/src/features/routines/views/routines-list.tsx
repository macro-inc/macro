import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Accessor, JSX } from 'solid-js';
import type { RoutineRowMenuActions } from '../components/routine-row-menu';
import {
  type RoutinesDiscover,
  RoutinesList,
} from '../components/routines-list';
import type { RoutineListSource } from '../context/routine-sources';
import type { RoutineTemplate } from '../core/routine-templates';
import type { RoutineRow } from '../core/types';
import { createRoutineRows } from '../primitives/routines-list';
import { toggleRoutine } from '../routine-toggle';

export function RoutinesListView(props: {
  source: RoutineListSource;
  userId: Accessor<string | undefined>;
  showTitle?: boolean;
  mobileHeader?: (focusSearch: () => void) => JSX.Element;
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
  // Turning one off on desktop can be taken back; a phone keeps its list as it was.
  const toggle = (row: RoutineRow) =>
    toggleRoutine(props.source, row, { undo: !isTouchDevice() });
  return (
    <RoutinesList
      showTitle={props.showTitle}
      mobileHeader={props.mobileHeader}
      registerSearchFocus={props.registerSearchFocus}
      rows={rows()}
      loading={props.source.loading()}
      error={props.source.error()}
      onRetry={() => fireAndForget(props.source.refresh(), 'routines')}
      onCreate={props.onCreate}
      onOpen={props.onOpen}
      pendingId={props.source.pendingId()}
      onToggle={toggle}
      templates={props.templates}
      onTemplate={props.onTemplate}
      discover={props.discover}
      menu={props.menu}
    />
  );
}
