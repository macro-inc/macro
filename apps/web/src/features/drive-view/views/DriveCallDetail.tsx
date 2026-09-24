import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  CallDetailActions,
  CallDetailView,
} from '@block-call/views/CallDetailView';
import { SplitPanel } from '@components/app/split-panel';
import PhoneCallIcon from '@phosphor/phone-call.svg';
import { type Accessor, onMount } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import {
  driveCallBreadcrumbValue,
  driveLocationBreadcrumbs,
} from '../core/breadcrumbs';

function DriveCallBreadcrumb(props: {
  callId: string;
  name: Accessor<string>;
}) {
  const { state, sidebar } = useDriveView();
  const order = () =>
    driveLocationBreadcrumbs(state.value().location, sidebar.folders()).length;

  return (
    <>
      <ViewBreadcrumbs.Item
        value={driveCallBreadcrumbValue(props.callId)}
        order={order()}
        metadata={{ type: 'call', id: props.callId }}
      >
        {(item) => (
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={props.name()}
          >
            <PhoneCallIcon class="size-4 shrink-0" />
            <span class="truncate">{props.name()}</span>
          </ViewBreadcrumbs.Button>
        )}
      </ViewBreadcrumbs.Item>
      <DriveBreadcrumbsOutlet aria-label="Call location" />
    </>
  );
}

export function DriveCallDetail(props: { callId: string }) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('call');
    analytics.track('open_entity', {
      entityType: 'call',
      entityId: props.callId,
    });
  });

  return (
    <CallDetailView callId={props.callId}>
      {({ record, name }) => (
        <ViewShell.TopBar class="touch:flex">
          <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
          <DriveCallBreadcrumb callId={props.callId} name={name} />
          <CallDetailActions callId={props.callId} record={record} />
        </ViewShell.TopBar>
      )}
    </CallDetailView>
  );
}
