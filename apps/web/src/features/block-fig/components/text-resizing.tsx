/** Text box resizing belongs with its dimensions in the Layout section. */
import type { TextInfo } from '@core/fig-engine/types';
import ArrowsOutLineHorizontal from '@phosphor/arrows-out-line-horizontal.svg';
import ArrowsOutLineVertical from '@phosphor/arrows-out-line-vertical.svg';
import FrameCorners from '@phosphor/frame-corners.svg';
import type { Patch } from '../primitives/create-fig-editor';
import { ChoiceRow } from './design-fields';

const RESIZE = [
  {
    value: 'WIDTH_AND_HEIGHT',
    label: 'Auto width',
    icon: <ArrowsOutLineHorizontal class="size-3.5" />,
  },
  {
    value: 'HEIGHT',
    label: 'Auto height',
    icon: <ArrowsOutLineVertical class="size-3.5" />,
  },
  {
    value: 'NONE',
    label: 'Fixed size',
    icon: <FrameCorners class="size-3.5" />,
  },
] as const;

export function TextResizing(props: {
  text: TextInfo;
  onPatch: (patch: Patch, live: boolean) => void;
}) {
  return (
    <ChoiceRow
      value={props.text.autoResize ?? 'NONE'}
      options={RESIZE}
      testId="fig-text-resize"
      onChange={(textAutoResize) => props.onPatch({ textAutoResize }, false)}
    />
  );
}
