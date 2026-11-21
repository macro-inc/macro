import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import EmptyStateCompaniesGraphic from '@design/empty-state-companies.svg';
import EmptyStateNoAccessGraphic from '@design/empty-state-no-access.svg';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { Button, EmptyStatePanel } from '@ui';
import { type Component, For, type JSX } from 'solid-js';

/** Presentational states for CRM lists; the caller owns the query and actions. */
export function CrmListEmpty(props: {
  title: string;
  description?: JSX.Element;
  graphic?: Component<{ class?: string }>;
  action?: { label: string; onClick: () => void };
  filtered?: boolean;
}) {
  return (
    <EmptyStatePanel
      centered
      topSpacerClass="grow-[0.5] basis-0 mobile:basis-0"
      graphic={
        props.filtered
          ? EmptyStateNoFilterMatchGraphic
          : (props.graphic ?? EmptyStateCompaniesGraphic)
      }
      title={props.title}
      description={props.description}
      primaryAction={props.action}
    />
  );
}

export function CrmListSearchEmpty(props: {
  title: string;
  description?: string;
  onClearSearch?: () => void;
}) {
  return (
    <EmptyStatePanel
      centered
      topSpacerClass="grow-[0.5] basis-0 mobile:basis-0"
      graphic={EmptyStateNoSearchMatchGraphic}
      title={props.title}
      description={props.description ?? 'Try a different search.'}
      primaryAction={
        props.onClearSearch
          ? { label: 'Clear search', onClick: props.onClearSearch }
          : undefined
      }
    />
  );
}

export function CrmListError(props: {
  title?: string;
  onRetry: () => Promise<unknown>;
}) {
  return (
    <EmptyStatePanel
      centered
      topSpacerClass="grow-[0.5] basis-0 mobile:basis-0"
      graphic={EmptyStateNoAccessGraphic}
      description={t('crm.listReloadHelp')}
      title={props.title ?? t('crm.listLoadFailed')}
      primaryAction={{
        label: t('crm.tryAgain'),
        onClick: () => fireAndForget(props.onRetry(), 'crm'),
      }}
    />
  );
}

export function CrmListSkeleton(props: { label?: string; count?: number }) {
  return (
    <ListSkeleton.Root
      label={props.label ?? 'Loading CRM list'}
      class="@container/crm-skeleton w-full shrink-0 overflow-hidden py-1"
    >
      <For each={Array.from({ length: props.count ?? 6 })}>
        {(_, index) => (
          <ListSkeleton.Row class="h-10 gap-2 px-3">
            <div class="size-4 shrink-0" />
            <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
            <div class="min-w-0 flex-1">
              <div
                style={{ width: `${[10, 8, 12, 9, 11, 7][index() % 6]}rem` }}
                class="max-w-full"
              >
                <ListSkeleton.Bar class="w-full" />
              </div>
            </div>
            <ListSkeleton.Bar class="hidden w-20 shrink-0 @lg/crm-skeleton:block" />
            <ListSkeleton.Bar class="hidden w-16 shrink-0 @3xl/crm-skeleton:block" />
            <div class="flex w-12 shrink-0 justify-end @lg/crm-skeleton:w-20">
              <ListSkeleton.Bar class="h-2 w-10 opacity-60" />
            </div>
          </ListSkeleton.Row>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** A failed request, kept distinct from an empty list, with a retry. */
export function CrmListRetry(props: {
  message: string;
  onRetry: () => Promise<unknown>;
}) {
  return (
    <div class="flex items-center justify-center gap-2 p-3 text-center text-xs text-ink-muted">
      <span>{props.message}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => fireAndForget(props.onRetry(), 'crm')}
      >
        Retry
      </Button>
    </div>
  );
}
