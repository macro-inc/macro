import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useRouteParams } from '@app/lib/split-router';
import { PrStatusIcon } from '@block-pr/component/PrStatus';
import { prDisplayName } from '@block-pr/util/prKey';
import {
  PrDetail,
  PrDetailActions,
  PrDetailLayout,
} from '@block-pr/views/PrDetail';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitPanel } from '@components/app/split-panel';
import { Permissions } from '@core/component/SharePermissions';
import { type Accessor, onMount } from 'solid-js';
import { tasksPrRoute } from '../route';

function TasksPrBreadcrumb(props: {
  foreignEntityId: string;
  name: Accessor<string>;
  status: Accessor<string | undefined>;
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
            tooltip={props.name()}
          >
            <PrStatusIcon
              status={props.status() ?? 'open'}
              class="size-4 shrink-0"
            />
            <span class="truncate">{props.name()}</span>
          </ViewBreadcrumbs.Button>
          <div class="shrink-0">
            <SplitFileMenu
              id={props.foreignEntityId}
              itemType="foreign"
              name={props.name()}
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

export function TasksPrDetail(props: { foreignEntityId: string }) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('pr');
    analytics.track('open_entity', {
      entityType: 'pr',
      entityId: props.foreignEntityId,
    });
  });

  return (
    <PrDetail foreignEntityId={props.foreignEntityId}>
      {(detail) => {
        const name = () => {
          const ref = detail.prRef();
          return (
            detail.pullRequest()?.name ??
            (ref ? prDisplayName(ref) : 'Pull request')
          );
        };
        return (
          <PrDetailLayout foreignEntityId={props.foreignEntityId} detail={detail}>
            <ViewShell.TopBar class="touch:flex">
              <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
              <ViewBreadcrumbs.Outlet aria-label="Pull request location" />
              <PrDetailActions detail={detail} />
            </ViewShell.TopBar>
            <TasksPrBreadcrumb
              foreignEntityId={props.foreignEntityId}
              name={name}
              status={() => detail.pullRequest()?.status}
            />
          </PrDetailLayout>
        );
      }}
    </PrDetail>
  );
}

export function TasksPrDetailRouteView() {
  const params = useRouteParams(tasksPrRoute);
  return <TasksPrDetail foreignEntityId={params.foreignEntityId} />;
}
