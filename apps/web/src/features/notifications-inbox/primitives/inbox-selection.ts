import { type Accessor, createSignal } from 'solid-js';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';

/**
 * The row shown in the preview. It follows the row's latest version while
 * the list holds it, and keeps its last version once it leaves, so the
 * preview doesn't vanish under the reader.
 */
export function createInboxSelection(
  rows: Accessor<readonly NotificationInboxRow[]>
) {
  const [snapshot, setSnapshot] = createSignal<NotificationInboxRow>();
  const [request, setRequest] = createSignal(0);

  const selected = () => {
    const current = snapshot();
    if (!current) return undefined;
    return rows().find((row) => row.id === current.id) ?? current;
  };

  /** Show `row`; choosing the shown row again re-aims it at its location. */
  const select = (row: NotificationInboxRow) => {
    if (snapshot()?.id === row.id) setRequest((count) => count + 1);
    setSnapshot(row);
  };

  const clear = () => setSnapshot(undefined);

  /**
   * Where to go when `leaving` rows leave the list while one of them is
   * shown: the next row that stays, else the nearest earlier one. `stay` when
   * the shown row isn't leaving; `none` when nothing is left.
   */
  const afterLeaving = (
    leaving: readonly string[]
  ): NotificationInboxRow | 'stay' | 'none' => {
    const current = snapshot();
    if (!current || !leaving.includes(current.id)) return 'stay';
    const list = rows();
    const index = list.findIndex((row) => row.id === current.id);
    const stays = (row: NotificationInboxRow) => !leaving.includes(row.id);
    return (
      list.slice(index + 1).find(stays) ??
      list.slice(0, Math.max(index, 0)).reverse().find(stays) ??
      'none'
    );
  };

  return {
    selected,
    /** Bumped when the shown row is chosen again. */
    navigationRequest: request,
    select,
    clear,
    afterLeaving,
  };
}
