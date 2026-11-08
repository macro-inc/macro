import { SidePanel } from '@components/app/side-panel';
import type { ParentProps } from 'solid-js';
import {
  RecordingViewProvider,
  useRecordingView,
} from '../../context/recording-view';

/** Coordinate the recording's floating cards without changing other side panels. */
export function CallRecordingRoot(props: ParentProps<{ callId: string }>) {
  return (
    <RecordingViewProvider callId={props.callId}>
      <RecordingDetailsRoot callId={props.callId}>
        {props.children}
      </RecordingDetailsRoot>
    </RecordingViewProvider>
  );
}

function RecordingDetailsRoot(props: ParentProps<{ callId: string }>) {
  const view = useRecordingView();
  return (
    <SidePanel.Root
      floating
      persistKey={`call:${props.callId}`}
      onOpenChange={(open) => {
        if (open) view.closeTranscript();
      }}
    >
      {props.children}
    </SidePanel.Root>
  );
}
