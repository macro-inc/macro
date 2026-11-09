import { SidePanel } from '@components/app/side-panel';
import type { ParentProps } from 'solid-js';
import { RecordingViewProvider } from '../../context/recording-view';

/** Share reading-tab and details state across recording hosts. */
export function CallRecordingRoot(props: ParentProps<{ callId: string }>) {
  return (
    <RecordingViewProvider>
      <SidePanel.Root floating persistKey={`call:${props.callId}`}>
        {props.children}
      </SidePanel.Root>
    </RecordingViewProvider>
  );
}
