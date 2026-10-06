import type { Alignment } from '@macro-inc/graphics';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowsHorizontal from '@phosphor/arrows-horizontal.svg';
import ArrowsVertical from '@phosphor/arrows-vertical.svg';
import Lock from '@phosphor/lock-simple.svg';
import LockOpen from '@phosphor/lock-simple-open.svg';
import { Button, ButtonGroup } from '@ui';
import { Show } from 'solid-js';
import type { LayoutField } from '../core/selection-layout';
import type { InspectorNumberScrub } from '../primitives/create-inspector-preview';
import { CanvasAlignmentControls } from './arrange-controls';
import { InspectorNumberField } from './inspector-number-field';
import { InspectorSection } from './inspector-section';

export function SelectionLayoutInspector(props: {
  count: number;
  snapUnit: number | undefined;
  lockAspectRatio: boolean;
  onLockAspectRatio: (locked: boolean) => void;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  value: (field: LayoutField) => number | undefined;
  onChange: (field: LayoutField, value: number) => void;
  onScrub: (field: LayoutField) => InspectorNumberScrub;
  onTransform: (action: 'rotate90' | 'flipX' | 'flipY') => void;
}) {
  return (
    <fieldset disabled={props.count === 0} class="min-w-0">
      <InspectorSection title="Position">
        <CanvasAlignmentControls
          count={props.count}
          onAlign={props.onAlign}
          onDistribute={props.onDistribute}
        />
        <div class="grid grid-cols-2 gap-2">
          <InspectorNumberField
            disabled={props.count === 0}
            label="Position X"
            icon={<span>X</span>}
            value={props.value('x')}
            min={-Infinity}
            step={props.snapUnit ?? 'any'}
            onChange={(value) => props.onChange('x', value)}
            onScrub={() => props.onScrub('x')}
          />
          <InspectorNumberField
            disabled={props.count === 0}
            label="Position Y"
            icon={<span>Y</span>}
            value={props.value('y')}
            min={-Infinity}
            step={props.snapUnit ?? 'any'}
            onChange={(value) => props.onChange('y', value)}
            onScrub={() => props.onScrub('y')}
          />
        </div>
        <p class="text-[10px] text-ink-muted">Rotation</p>
        <div class="grid grid-cols-2 items-center gap-2">
          <InspectorNumberField
            disabled={props.count === 0}
            label="Rotation"
            icon={<ArrowClockwise class="size-4" />}
            value={props.value('rotation')}
            min={-Infinity}
            step={1}
            unit="°"
            onChange={(value) => props.onChange('rotation', value)}
            onScrub={() => props.onScrub('rotation')}
          />
          <ButtonGroup size="icon-sm" class="w-full rounded-md bg-hover/50">
            <Button
              fullWidth
              class="bg-transparent"
              label="Rotate 90°"
              onClick={() => props.onTransform('rotate90')}
            >
              <ArrowClockwise />
            </Button>
            <Button
              fullWidth
              class="bg-transparent"
              label="Flip horizontal"
              onClick={() => props.onTransform('flipX')}
            >
              <ArrowsHorizontal />
            </Button>
            <Button
              fullWidth
              class="bg-transparent"
              label="Flip vertical"
              onClick={() => props.onTransform('flipY')}
            >
              <ArrowsVertical />
            </Button>
          </ButtonGroup>
        </div>
      </InspectorSection>
      <InspectorSection title="Layout">
        <p class="text-[10px] text-ink-muted">Dimensions</p>
        <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
          <InspectorNumberField
            disabled={props.count === 0}
            label="Width"
            icon={<span>W</span>}
            value={props.value('width')}
            min={props.snapUnit ?? 0}
            step={props.snapUnit ?? 'any'}
            onChange={(value) => props.onChange('width', value)}
            onScrub={() => props.onScrub('width')}
          />
          <InspectorNumberField
            disabled={props.count === 0}
            label="Height"
            icon={<span>H</span>}
            value={props.value('height')}
            min={props.snapUnit ?? 0}
            step={props.snapUnit ?? 'any'}
            onChange={(value) => props.onChange('height', value)}
            onScrub={() => props.onScrub('height')}
          />
          <Button
            size="icon-sm"
            label="Lock aspect ratio"
            aria-pressed={props.lockAspectRatio}
            class="aria-pressed:bg-active aria-pressed:text-ink"
            onClick={() => props.onLockAspectRatio(!props.lockAspectRatio)}
          >
            <Show when={props.lockAspectRatio} fallback={<LockOpen />}>
              <Lock />
            </Show>
          </Button>
        </div>
        <Show when={props.count > 1}>
          <p class="text-[10px] text-ink-muted">Spacing</p>
          <div class="grid grid-cols-2 gap-2">
            <InspectorNumberField
              disabled={props.count === 0}
              label="Horizontal spacing"
              icon={<ArrowsHorizontal class="size-4" />}
              value={props.value('gapX')}
              min={-Infinity}
              step={props.snapUnit ?? 'any'}
              onChange={(value) => props.onChange('gapX', value)}
              onScrub={() => props.onScrub('gapX')}
            />
            <InspectorNumberField
              disabled={props.count === 0}
              label="Vertical spacing"
              icon={<ArrowsVertical class="size-4" />}
              value={props.value('gapY')}
              min={-Infinity}
              step={props.snapUnit ?? 'any'}
              onChange={(value) => props.onChange('gapY', value)}
              onScrub={() => props.onScrub('gapY')}
            />
          </div>
        </Show>
      </InspectorSection>
    </fieldset>
  );
}
