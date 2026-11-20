import { SidePanel } from '@components/app/side-panel';
import type { ParentProps } from 'solid-js';

/** Own details state for both recording hosts. */
export function CallRecordingRoot(props: ParentProps<{ callId: string }>) {
  return (
    <SidePanel.Root floating persistKey={`call:${props.callId}`}>
      {props.children}
    </SidePanel.Root>
  );
}
