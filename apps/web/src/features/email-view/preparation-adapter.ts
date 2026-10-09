import { prepareEmailThreads } from '@app/features/email-thread/preparation-adapter';
import { useEmailRenderCache } from '@app/lib/email-render-cache/session';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createPreparationWindow } from './preparation-window';
import type { EmailDataSourceItem } from './queries/use-email-query';

export function emailThreadId(
  row: EmailDataSourceItem | undefined
): string | undefined {
  return row?.kind === 'entity' && row.entity.type === 'email'
    ? row.entity.id
    : undefined;
}

export function emailThreadIds(rows: readonly EmailDataSourceItem[]): string[] {
  return rows.flatMap((row) => emailThreadId(row) ?? []);
}

/** Translate reactive navigation values and dispose with the owning view. */
export function usePrepareEmailNeighbors(
  ids: Accessor<readonly string[]>,
  focusedId: Accessor<string | undefined>
) {
  const cache = useEmailRenderCache();
  const preparation = createPreparationWindow((service, id, priority) =>
    prepareEmailThreads(service, [id], priority)
  );
  createEffect(
    on([cache, ids, focusedId], ([service, ordered, focused]) =>
      preparation.update(service, ordered, focused)
    )
  );
  onCleanup(() => preparation.dispose());
}
