import { type Accessor, batch, createSignal } from 'solid-js';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';

/**
 * The row shown in the preview, and which of its notifications when one was
 * chosen from its stack. It follows the row's latest version while the list
 * holds it, and keeps its last version once it leaves, so the preview doesn't
 * vanish under the reader.
 */
export function createInboxSelection(
  rows: Accessor<readonly NotificationInboxRow[]>
) {
  const [snapshot, setSnapshot] = createSignal<NotificationInboxRow>();
  const [notificationId, setNotificationId] = createSignal<string>();
  const [request, setRequest] = createSignal(0);

  const selected = () => {
    const current = snapshot();
    if (!current) return undefined;
    return rows().find((row) => row.id === current.id) ?? current;
  };

  /**
   * The chosen notification of the shown row, while the row still holds it.
   * Without one the preview opens where the row does.
   */
  const selectedNotification = () => {
    const id = notificationId();
    if (!id) return undefined;
    return selected()?.content.notifications.find(
      (notification) => notification.id === id
    );
  };

  /**
   * Show `row`, at one of its notifications when one is named; choosing what's
   * shown again re-aims it at its location.
   */
  const select = (row: NotificationInboxRow, notification?: string) => {
    batch(() => {
      if (snapshot()?.id === row.id && notificationId() === notification) {
        setRequest((count) => count + 1);
      }
      setSnapshot(row);
      setNotificationId(notification);
    });
  };

  const clear = () =>
    batch(() => {
      setSnapshot(undefined);
      setNotificationId(undefined);
    });

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
    selectedNotification,
    /** Bumped when what's shown is chosen again. */
    navigationRequest: request,
    select,
    clear,
    afterLeaving,
  };
}
