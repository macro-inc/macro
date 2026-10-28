import type { JSX } from 'solid-js';
import { useCallContext } from '../CallContext';
import { CallMediaControls } from './CallMediaControls';

export function CallControlsDefaultAndPanelRow(props: {
  onLeave: () => void | Promise<void>;
  extra?: JSX.Element;
}) {
  return (
    <CallMediaControls
      media={useCallContext()}
      onLeave={props.onLeave}
      extra={props.extra}
    />
  );
}
