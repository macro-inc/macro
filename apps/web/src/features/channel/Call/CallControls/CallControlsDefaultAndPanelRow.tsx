import type { JSX } from 'solid-js';
import { useCallContext } from '../CallContext';
import { CallMediaControls } from './CallMediaControls';

export function CallControlsDefaultAndPanelRow(props: {
  onLeave: () => void | Promise<void>;
  onSettingsOpenChange?: (open: boolean) => void;
  children?: JSX.Element;
}) {
  return (
    <CallMediaControls
      media={useCallContext()}
      onLeave={props.onLeave}
      onSettingsOpenChange={props.onSettingsOpenChange}
    >
      {props.children}
    </CallMediaControls>
  );
}
