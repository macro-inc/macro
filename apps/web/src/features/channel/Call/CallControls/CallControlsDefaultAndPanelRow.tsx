import { useCallContext } from '../CallContext';
import { CallMediaControls } from './CallMediaControls';

export function CallControlsDefaultAndPanelRow(props: {
  onLeave: () => void | Promise<void>;
}) {
  return <CallMediaControls media={useCallContext()} onLeave={props.onLeave} />;
}
