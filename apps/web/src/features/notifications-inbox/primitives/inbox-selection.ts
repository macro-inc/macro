import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';

/** The shown row and the chosen notification of its stack; '' for none. */
export type InboxShownRow = { row: string; item: string };

/** Where the shown row is kept, such as the view's URL. */
export type InboxShownRowLocation = {
  shown: Accessor<InboxShownRow>;
  /** `replace` overwrites the current history entry instead of adding one. */
  show: (next: InboxShownRow, options: { replace: boolean }) => void;
};

type ShowOptions = { replace?: boolean };

/**
 * The row shown in the preview, and which of its notifications when one was
 * chosen from its stack, as `location` holds them. It follows the row's latest
 * version while the list holds it, and keeps its last version once it leaves,
 * so the preview doesn't vanish under the reader.
 */
export function createInboxSelection(
  rows: Accessor<readonly NotificationInboxRow[]>,
  location: InboxShownRowLocation
) {
  const [request, setRequest] = createSignal(0);

  const selected = createMemo<NotificationInboxRow | undefined>((previous) => {
    const id = location.shown().row;
    if (!id) return undefined;
    const current = rows().find((row) => row.id === id);
    if (current) return current;
    return previous?.id === id ? previous : undefined;
  });

  /**
   * The chosen notification of the shown row, while the row still holds it.
   * Without one the preview opens where the row does.
   */
  const selectedNotification = () => {
    const id = location.shown().item;
    if (!id) return undefined;
    return selected()?.content.notifications.find(
      (notification) => notification.id === id
    );
  };

  /**
   * Show `row`, at one of its notifications when one is named; choosing what's
   * shown again re-aims it at its location.
   */
  const select = (
    row: NotificationInboxRow,
    notification?: string,
    options: ShowOptions = {}
  ) => {
    const next = { row: row.id, item: notification ?? '' };
    const shown = location.shown();
    if (shown.row === next.row && shown.item === next.item) {
      setRequest((count) => count + 1);
      return;
    }
    location.show(next, { replace: options.replace ?? false });
  };

  const clear = (options: ShowOptions = {}) =>
    location.show({ row: '', item: '' }, { replace: options.replace ?? false });

  /**
   * Where to go when `leaving` rows leave the list while one of them is
   * shown: the next row that stays, else the nearest earlier one. `stay` when
   * the shown row isn't leaving; `none` when nothing is left.
   */
  const afterLeaving = (
    leaving: readonly string[]
  ): NotificationInboxRow | 'stay' | 'none' => {
    const current = selected();
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
    selectedNotification,
    /** Bumped when what's shown is chosen again. */
    navigationRequest: request,
    select,
    clear,
    afterLeaving,
  };
}
