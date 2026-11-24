import { t } from '@app/lib/i18n';
import type { EntityData } from '@entity';
import { Badge } from '@ui';
import { Show } from 'solid-js';

/**
 * Where a search result lives, when the search reaches beyond the inbox: an
 * archived thread says so, since the inbox lists never show it. A thread of
 * only sent mail or drafts was never in the inbox, so it is not archived.
 */
export function EmailSearchLocation(props: {
  entity: EntityData;
  /** The list shows search results that can include archived mail. */
  reachesArchived: boolean;
}) {
  const archived = () =>
    props.reachesArchived &&
    props.entity.type === 'email' &&
    props.entity.done === true &&
    props.entity.hasReceivedMail !== false;

  return (
    <Show when={archived()}>
      <Badge
        variant="outline"
        size="xs"
        class="shrink-0 select-none border-edge-button bg-control text-ink-muted"
      >
        {t('emailViews.archived')}
      </Badge>
    </Show>
  );
}
