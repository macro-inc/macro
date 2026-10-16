import type { EntityData } from '@entity';
import { createSignal } from 'solid-js';

/** A state a bulk action asked the server for, shown until lists catch up. */
export type EmailBulkIntent = {
  done?: boolean;
  read?: boolean;
  /** The thread's view position when it was targeted, in epoch ms. */
  sortTs: number;
};

export type EmailBulkIntentTarget = { id: string; sortTs: string };

export type EmailBulkOverlay = ReturnType<typeof createEmailBulkOverlay>;

const time = (value: Date | string) => new Date(value).getTime();

/**
 * Optimistic state for threads a bulk action changes. A selection can reach
 * thousands of threads the list never loaded, so intents are kept by id and
 * applied to whichever rows the list shows, rather than patched into caches.
 */
export function createEmailBulkOverlay() {
  const [intents, setIntents] = createSignal<
    ReadonlyMap<string, EmailBulkIntent>
  >(new Map());

  const set = (
    targets: readonly EmailBulkIntentTarget[],
    change: Pick<EmailBulkIntent, 'done' | 'read'>
  ) =>
    setIntents((current) => {
      const next = new Map(current);
      for (const target of targets) {
        next.set(target.id, {
          ...next.get(target.id),
          ...change,
          sortTs: time(target.sortTs),
        });
      }
      return next;
    });

  const remove = (ids: readonly string[]) =>
    setIntents((current) => {
      const next = new Map(current);
      for (const id of ids) next.delete(id);
      return next;
    });

  const clear = () => setIntents(new Map());

  /**
   * Rows as the pending intents will leave them; `belongs` decides whether a
   * changed row still belongs in the view (a done thread leaves Signal).
   */
  const apply = <T extends EntityData>(
    entities: T[],
    belongs: (entity: T) => boolean
  ) => {
    const current = intents();
    if (current.size === 0) return entities;
    return entities.flatMap((entity): T[] => {
      const intent = entity.type === 'email' && current.get(entity.id);
      if (!intent) return [entity];
      const changed: T = {
        ...entity,
        ...(intent.done === undefined ? {} : { done: intent.done }),
        ...(intent.read === undefined ? {} : { isRead: intent.read }),
      };
      return belongs(changed) ? [changed] : [];
    });
  };

  /**
   * Forget intents a fetched row already agrees with, and intents for threads
   * with mail newer than the action: the server's state wins for those.
   */
  const reconcile = (entities: readonly EntityData[]) => {
    const current = intents();
    if (current.size === 0) return;
    const settled = entities.flatMap((entity) => {
      if (entity.type !== 'email') return [];
      const intent = current.get(entity.id);
      if (!intent) return [];
      const agrees =
        (intent.done === undefined || entity.done === intent.done) &&
        (intent.read === undefined || entity.isRead === intent.read);
      const moved =
        entity.sortTs != null && time(entity.sortTs) > intent.sortTs;
      return agrees || moved ? [entity.id] : [];
    });
    if (settled.length > 0) remove(settled);
  };

  return { intents, set, remove, clear, apply, reconcile };
}
