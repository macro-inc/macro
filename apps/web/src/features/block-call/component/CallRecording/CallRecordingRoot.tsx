import { SidePanel } from '@components/app/side-panel';
import type { ParentProps } from 'solid-js';
import { RecordingViewProvider } from '../../context/recording-view';

/** Share recording and details state without coupling their open states. */
export function CallRecordingRoot(props: ParentProps<{ callId: string }>) {
  return (
    <RecordingViewProvider callId={props.callId}>
      <SidePanel.Root floating persistKey={`call:${props.callId}`}>
        {props.children}
      </SidePanel.Root>
    </RecordingViewProvider>
  );
}
