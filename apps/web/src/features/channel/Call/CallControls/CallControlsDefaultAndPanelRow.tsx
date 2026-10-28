import { useCallContext } from '../CallContext';
import { CallMediaControls } from './CallMediaControls';

export function CallControlsDefaultAndPanelRow(props: {
  onLeave: () => void | Promise<void>;
  onSettingsOpenChange?: (open: boolean) => void;
}) {
  return (
    <CallMediaControls
      media={useCallContext()}
      onLeave={props.onLeave}
      onSettingsOpenChange={props.onSettingsOpenChange}
    />
  );
}
