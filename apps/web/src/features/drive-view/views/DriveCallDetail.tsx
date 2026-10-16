import { ViewBreadcrumbs } from '@app/components/view-shell';
import { CallDetailView } from '@block-call/views/CallDetailView';
import PhoneCallIcon from '@phosphor/phone-call.svg';
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
  messageId?: string;
  seek?: string;
}) {
  return (
    <CallDetailView
      callId={props.callId}
      transcriptId={props.transcriptId}
      messageId={props.messageId}
      seek={props.seek}
      header={(data) => (
        <DriveCallBreadcrumb
          callId={props.callId}
          name={data()?.name ?? 'Call Recording'}
        />
      )}
    />
  );
}
