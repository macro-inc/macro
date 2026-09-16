import { ViewBreadcrumbs } from '@app/components/view-shell';
import { SidePanel } from '@components/app/side-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useCompanyQuery } from '@queries/crm/companies';
import { Button, Tooltip } from '@ui';
import { ErrorBoundary, type JSX, onMount, Show, Suspense } from 'solid-js';
import { Company } from '../Company/Company';

export function CrmCompanyDetail(props: {
  company: { id: string; name: string };
  viewName: string;
  onClose: () => void;
  navigation: JSX.Element;
}) {
  const { query, company } = useCompanyQuery(() => props.company.id);
  const companyName = () => company()?.name ?? props.company.name;
  let container: HTMLDivElement | undefined;
  onMount(() => container?.focus());

  return (
    <ViewBreadcrumbs.Root
      value={`company:${props.company.id}`}
      onChange={(value) => {
        if (value === 'crm-view') props.onClose();
      }}
    >
      <ViewBreadcrumbs.Item value="crm-view" order={0}>
        {(item) => (
          <Tooltip label={`Back to ${props.viewName}`} class="min-w-0">
            <ViewBreadcrumbs.Button
              isActive={item.isActive()}
              onClick={item.onSelect}
            >
              <span class="truncate">{props.viewName}</span>
            </ViewBreadcrumbs.Button>
          </Tooltip>
        )}
      </ViewBreadcrumbs.Item>
      <ViewBreadcrumbs.Item value={`company:${props.company.id}`} order={1}>
        {(item) => (
          <Tooltip label={companyName()} class="min-w-0">
            <ViewBreadcrumbs.Button
              isActive={item.isActive()}
              onClick={item.onSelect}
              class="gap-1.5"
            >
              <EntityIcon targetType="crm_company" size="xs" class="shrink-0" />
              <span class="truncate">{companyName()}</span>
            </ViewBreadcrumbs.Button>
          </Tooltip>
        )}
      </ViewBreadcrumbs.Item>
      <SidePanel.Root persistKey="crm-company">
        <div
          ref={container}
          tabindex={-1}
          class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
        >
          <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 border-b border-edge-muted px-4">
            {props.navigation}
            <ViewBreadcrumbs.Outlet
              aria-label="Company location"
              class="flex-1"
            />
            <SidePanel.Toggle />
          </div>
          <div class="relative min-h-0 min-w-0 flex-1">
            <ErrorBoundary
              fallback={(_, reset) => (
                <DetailError onRetry={reset} onClose={props.onClose} />
              )}
            >
              <Show
                when={!query.isError}
                fallback={
                  <DetailError
                    onRetry={() => void query.refetch()}
                    onClose={props.onClose}
                  />
                }
              >
                <Suspense
                  fallback={
                    <div class="grid size-full place-items-center text-ink-muted">
                      <SpinnerIcon
                        aria-label="Loading company"
                        class="size-5 animate-spin"
                      />
                    </div>
                  }
                >
                  <Company
                    companyId={props.company.id}
                    headerToggle={false}
                    onHidden={props.onClose}
                  />
                </Suspense>
              </Show>
            </ErrorBoundary>
          </div>
        </div>
      </SidePanel.Root>
    </ViewBreadcrumbs.Root>
  );
}

function DetailError(props: { onRetry: () => void; onClose: () => void }) {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-3 text-sm text-ink-muted">
      <p>This company couldn’t be loaded.</p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Try again
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          Back to view
        </Button>
      </div>
    </div>
  );
}
