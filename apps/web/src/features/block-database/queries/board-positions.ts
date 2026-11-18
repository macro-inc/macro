import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { Accessor } from 'solid-js';
import type { BoardPositionsState } from '../../database/primitives/board-layout';
import type { BoardPositions } from '../../database/views/database-board-view';
import { moveDatabaseCard, setCardPositions, useCardPositions } from './views';

/** The database host's saved board positions and move capabilities. */
export function useDatabaseBoardPositions(
  databaseId: string,
  view: Accessor<DatabaseView>,
  stored: Accessor<boolean>
): BoardPositions {
  const boardViewId = () =>
    stored() && view().layout.kind === 'board' ? view().id : undefined;
  const positions = useCardPositions(databaseId, boardViewId);
  return {
    get viewId() {
      return view().id;
    },
    state: (): BoardPositionsState => {
      if (!stored()) return { kind: 'ready', positions: [] };
      if (queryReadyGate(positions))
        return { kind: 'ready', positions: positions.data };
      if (positions.isError)
        return {
          kind: 'failed',
          retry: () => fireAndForget(positions.refetch(), 'database-view'),
        };
      return { kind: 'loading' };
    },
    get setPositions(): BoardPositions['setPositions'] {
      const viewId = boardViewId();
      return viewId
        ? (change) => setCardPositions(databaseId, viewId, change)
        : undefined;
    },
    get move(): BoardPositions['move'] {
      const origin = view();
      return (move) => moveDatabaseCard(origin, move);
    },
  };
}
