import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useRouteParams } from '@app/lib/split-router';
import { PrStatusIcon } from '@block-pr/component/PrStatus';
import { prDisplayName, prHtmlUrl } from '@block-pr/util/prKey';
import {
  PrDetailActions,
  PrDetailContent,
  usePrDetail,
} from '@block-pr/views/PrDetail';
import { SidePanel } from '@components/app/side-panel';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitPanel } from '@components/app/split-panel';
import { Permissions } from '@core/component/SharePermissions';
import { onMount } from 'solid-js';
import { reviewsPrRoute } from '../route';

function ReviewsPrBreadcrumb(props: {
  foreignEntityId: string;
  name: string;
  status?: string;
}) {
  return (
    <ViewBreadcrumbs.Item
      value={`pr:${props.foreignEntityId}`}
      order={1}
      metadata={{ type: 'pr', id: props.foreignEntityId }}
    >
      {(item) => (
        <div class="flex min-w-0 items-center">
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={props.name}
          >
            <PrStatusIcon
              status={props.status ?? 'open'}
              class="size-4 shrink-0"
            />
            <span class="truncate">{props.name}</span>
          </ViewBreadcrumbs.Button>
          <div class="shrink-0">
            <SplitFileMenu
              id={props.foreignEntityId}
              itemType="foreign"
              name={props.name}
              entityKind="pr"
              permissions={Permissions.CAN_VIEW}
              ops={[]}
            />
          </div>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}

export function ReviewsPrDetail(props: { foreignEntityId: string }) {
  const analytics = useAnalytics();
  const detail = usePrDetail(() => props.foreignEntityId);
  const name = () => {
    const data = detail.data();
    return (
      data?.pullRequest.name ??
      (data ? prDisplayName(data.prRef) : 'Pull request')
    );
  };
  const githubUrl = () => {
    const data = detail.data();
    return data ? (data.pullRequest.url ?? prHtmlUrl(data.prRef)) : undefined;
  };
  onMount(() => {
    analytics.pageView('pr');
    analytics.track('open_entity', {
      entityType: 'pr',
      entityId: props.foreignEntityId,
    });
  });

  return (
    <SidePanel.Root persistKey={`pr:${props.foreignEntityId}`}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
        <ViewShell.TopBar class="touch:flex">
          <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
          <ViewBreadcrumbs.Outlet aria-label="Pull request location" />
          <PrDetailActions url={githubUrl()} />
        </ViewShell.TopBar>
        <ReviewsPrBreadcrumb
          foreignEntityId={props.foreignEntityId}
          name={name()}
          status={detail.data()?.pullRequest.status ?? undefined}
        />
        <PrDetailContent
          foreignEntityId={props.foreignEntityId}
          data={detail.data()}
          status={detail.query.status}
          discussionSource={detail.discussionSource}
          onRetry={() => void detail.query.refetch()}
        />
      </div>
    </SidePanel.Root>
  );
}

export function ReviewsPrDetailRouteView() {
  const params = useRouteParams(reviewsPrRoute);
  return <ReviewsPrDetail foreignEntityId={params.foreignEntityId} />;
}
