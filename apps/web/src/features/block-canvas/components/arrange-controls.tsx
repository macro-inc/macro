import AlignBottom from '@icon/system/regular/align-bottom-simple.svg';
import AlignCenter from '@icon/system/regular/align-center-horizontal-simple.svg';
import AlignMiddle from '@icon/system/regular/align-center-vertical-simple.svg';
import AlignLeft from '@icon/system/regular/align-left-simple.svg';
import AlignRight from '@icon/system/regular/align-right-simple.svg';
import AlignTop from '@icon/system/regular/align-top-simple.svg';
import ArrowsHorizontal from '@icon/system/regular/arrows-horizontal.svg';
import ArrowsVertical from '@icon/system/regular/arrows-vertical.svg';
import type { Alignment } from '@macro-inc/graphics';
import { Button, ButtonGroup } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { INSPECTOR_CONTROL_FRAME_CLASS } from './inspector-control-frame';

export function CanvasAlignmentControls(props: {
  count: number;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
}) {
  return (
    <div class="space-y-2">
      <div class="grid grid-cols-2 gap-2">
        <For
          each={
            [
              [
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ],
              [
                ['top', AlignTop],
                ['middle', AlignMiddle],
                ['bottom', AlignBottom],
              ],
            ] as const
          }
        >
          {(alignments) => (
            <ButtonGroup
              size="icon-sm"
              class={`w-full data-[orientation=horizontal]:rounded-lg ${INSPECTOR_CONTROL_FRAME_CLASS}`}
            >
              <For each={alignments}>
                {([alignment, icon]) => (
                  <>
                    <Button
                      fullWidth
                      class="bg-transparent"
                      label={`Align ${alignment}`}
                      disabled={props.count < 2}
                      onClick={() => props.onAlign(alignment)}
                    >
                      <Dynamic component={icon} />
                    </Button>
                  </>
                )}
              </For>
            </ButtonGroup>
          )}
        </For>
      </div>
      <Show when={props.count >= 3}>
        <ButtonGroup
          size="icon-sm"
          class={`data-[orientation=horizontal]:rounded-lg ${INSPECTOR_CONTROL_FRAME_CLASS}`}
        >
          <Button
            label="Distribute horizontal"
            disabled={props.count < 3}
            onClick={() => props.onDistribute('horizontal')}
          >
            <ArrowsHorizontal />
          </Button>
          <Button
            label="Distribute vertical"
            disabled={props.count < 3}
            onClick={() => props.onDistribute('vertical')}
          >
            <ArrowsVertical />
          </Button>
        </ButtonGroup>
      </Show>
    </div>
  );
}
