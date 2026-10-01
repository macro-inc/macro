import type { Alignment } from '@macro-inc/graphics';
import AlignBottom from '@phosphor/align-bottom-simple.svg';
import AlignCenter from '@phosphor/align-center-horizontal-simple.svg';
import AlignMiddle from '@phosphor/align-center-vertical-simple.svg';
import AlignLeft from '@phosphor/align-left-simple.svg';
import AlignRight from '@phosphor/align-right-simple.svg';
import AlignTop from '@phosphor/align-top-simple.svg';
import ArrowsHorizontal from '@phosphor/arrows-horizontal.svg';
import ArrowsVertical from '@phosphor/arrows-vertical.svg';
import { Button, ButtonGroup } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';

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
            <ButtonGroup size="icon-md" variant="outline" class="w-full">
              <For each={alignments}>
                {([alignment, icon], index) => (
                  <>
                    {index() > 0 && <ButtonGroup.Divider />}
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
      <ButtonGroup size="icon-md">
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
    </div>
  );
}
