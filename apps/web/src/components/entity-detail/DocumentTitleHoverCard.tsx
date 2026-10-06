import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { getDisplayName, tryMacroId } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import { useSoupItemsQuery } from '@queries/soup/items';
import { HoverCard } from '@ui';
import { type ParentProps, Show } from 'solid-js';

type DocumentTitleProps = {
  documentId: string;
  name: string;
  ownerId?: string;
  createdAt?: DateValue | null;
  updatedAt?: DateValue | null;
};

function DocumentTitleDetails(props: DocumentTitleProps) {
  const quickAccess = useQuickAccess();
  const cached = () => {
    const item = quickAccess.getById(props.documentId);
    return item?.kind === 'entity' ? item : undefined;
  };
  const metadata = useSoupItemsQuery(
    () => ({
      params: { limit: 1 },
      body: {
        ...QUERY_FILTERS_BASE,
        document_filters: { document_ids: [props.documentId] },
      },
    }),
    () => ({ staleTime: 60_000 })
  );
  const resolved = () =>
    metadata.isSuccess
      ? metadata.data.find((item) => item.id === props.documentId)
      : undefined;
  const ownerId = () =>
    props.ownerId ?? cached()?.data.ownerId ?? resolved()?.ownerId;
  const updatedAt = () =>
    props.updatedAt ?? cached()?.timestamps.updatedAt ?? resolved()?.updatedAt;
  const createdAt = () =>
    props.createdAt ?? cached()?.timestamps.createdAt ?? resolved()?.createdAt;
  const timestamp = (value: DateValue | null | undefined) =>
    value ? formatDate(value, { showTime: true }) : 'Not available';

  return (
    <div
      class="w-full text-ink"
      role="group"
      aria-label={`Details for ${props.name}`}
    >
      <div class="flex min-w-0 items-center gap-2.5 pb-3">
        <Show when={ownerId()}>
          {(owner) => (
            <UserIcon
              id={owner()}
              size="md"
              suppressClick
              showTooltip={false}
            />
          )}
        </Show>
        <div class="min-w-0 truncate text-xs">
          <Show when={ownerId()} fallback="Not available">
            {(owner) => getDisplayName(tryMacroId(owner())) || owner()}
          </Show>
        </div>
      </div>
      <dl class="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-[2em] gap-y-1.5 border-t border-edge-muted pt-2.5">
        <dt class="text-ink-muted">Created</dt>
        <dd class="text-left tabular-nums">{timestamp(createdAt())}</dd>
        <dt class="text-ink-muted">Updated</dt>
        <dd class="text-left tabular-nums">{timestamp(updatedAt())}</dd>
      </dl>
    </div>
  );
}

/** Shared document header metadata, loaded only while the title card is open. */
export function DocumentTitleHoverCard(props: ParentProps<DocumentTitleProps>) {
  return (
    <HoverCard
      triggerClass="min-w-0"
      contentClass="w-72 p-3"
      placement="bottom-start"
      content={<DocumentTitleDetails {...props} />}
    >
      {props.children}
    </HoverCard>
  );
}
