import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  CallDetailActions,
  CallDetailContent,
  CallDetailRoot,
  useCallDetail,
} from '@block-call/views/CallDetailView';
import { SplitPanel } from '@components/app/split-panel';
import PhoneCallIcon from '@phosphor/phone-call.svg';
import { onMount, Show } from 'solid-js';
import { DriveBreadcrumbsOutlet } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import {
  driveCallBreadcrumbValue,
  driveLocationBreadcrumbs,
} from '../core/breadcrumbs';

function DriveCallBreadcrumb(props: { callId: string; name: string }) {
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
            tooltip={props.name}
          >
            <PhoneCallIcon class="size-4 shrink-0" />
            <span class="truncate">{props.name}</span>
          </ViewBreadcrumbs.Button>
        )}
      </ViewBreadcrumbs.Item>
      <DriveBreadcrumbsOutlet aria-label="Call location" />
    </>
  );
}

export function DriveCallDetail(props: {
  callId: string;
  transcriptId?: string;
  seek?: string;
}) {
  const detail = useCallDetail(() => props.callId);
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('call');
    analytics.track('open_entity', {
      entityType: 'call',
      entityId: props.callId,
    });
  });

  return (
    <CallDetailRoot callId={props.callId}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
        <ViewShell.TopBar class="touch:flex">
          <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
          <DriveCallBreadcrumb
            callId={props.callId}
            name={detail.data()?.name ?? 'Call Recording'}
          />
          <Show when={detail.data()}>
            {(data) => (
              <CallDetailActions
                callId={props.callId}
                record={data().record}
                name={data().name}
              />
            )}
          </Show>
        </ViewShell.TopBar>
        <CallDetailContent
          callId={props.callId}
          query={detail.query}
          data={detail.data()}
          transcriptId={props.transcriptId}
          seek={props.seek}
        />
      </div>
    </CallDetailRoot>
  );
}
