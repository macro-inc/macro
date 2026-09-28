import type { Alignment, LayerOperation } from '@macro-inc/graphics';
import AlignBottom from '@phosphor/align-bottom-simple.svg';
import AlignCenter from '@phosphor/align-center-horizontal-simple.svg';
import AlignMiddle from '@phosphor/align-center-vertical-simple.svg';
import AlignLeft from '@phosphor/align-left-simple.svg';
import AlignRight from '@phosphor/align-right-simple.svg';
import AlignTop from '@phosphor/align-top-simple.svg';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowLineDown from '@phosphor/arrow-line-down.svg';
import ArrowLineUp from '@phosphor/arrow-line-up.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import ArrowsHorizontal from '@phosphor/arrows-horizontal.svg';
import ArrowsVertical from '@phosphor/arrows-vertical.svg';
import SelectionPlus from '@phosphor/selection-plus.svg';
import SelectionSlash from '@phosphor/selection-slash.svg';
import { Button, ButtonGroup } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export function CanvasArrangeControls(props: {
  count: number;
  canGroup: boolean;
  canUngroup: boolean;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onLayer: (operation: LayerOperation) => void;
}) {
  return (
    <section class="space-y-2 p-3" aria-label="Arrange selection">
      <h2 class="text-xs font-medium">Arrange</h2>
      <ButtonGroup size="icon-md">
        <For
          each={
            [
              ['left', AlignLeft],
              ['center', AlignCenter],
              ['right', AlignRight],
              ['top', AlignTop],
              ['middle', AlignMiddle],
              ['bottom', AlignBottom],
            ] as const
          }
        >
          {([alignment, icon]) => (
            <Button
              label={`Align ${alignment}`}
              disabled={props.count < 2}
              onClick={() => props.onAlign(alignment)}
            >
              <Dynamic component={icon} />
            </Button>
          )}
        </For>
      </ButtonGroup>
      <div class="flex items-center justify-between">
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
        <ButtonGroup size="icon-md">
          <Button
            label="Group"
            shortcut="cmd+g"
            disabled={!props.canGroup}
            onClick={props.onGroup}
          >
            <SelectionPlus />
          </Button>
          <Button
            label="Ungroup"
            shortcut="shift+cmd+g"
            disabled={!props.canUngroup}
            onClick={props.onUngroup}
          >
            <SelectionSlash />
          </Button>
        </ButtonGroup>
      </div>
      <ButtonGroup size="icon-md">
        <For
          each={
            [
              ['back', 'Send to back', ArrowLineDown],
              ['backward', 'Send backward', ArrowDown],
              ['forward', 'Bring forward', ArrowUp],
              ['front', 'Bring to front', ArrowLineUp],
            ] as const
          }
        >
          {([operation, label, icon]) => (
            <Button
              label={label}
              disabled={!props.count}
              onClick={() => props.onLayer(operation)}
            >
              <Dynamic component={icon} />
            </Button>
          )}
        </For>
      </ButtonGroup>
    </section>
  );
}
