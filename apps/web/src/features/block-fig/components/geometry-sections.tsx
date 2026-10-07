/** Position and layout controls in the same groups as the Figma inspector. */
import type { NodeInfo } from '@core/fig-engine/types';
import AlignBottom from '@phosphor/align-bottom.svg';
import AlignCenterHorizontal from '@phosphor/align-center-horizontal.svg';
import AlignCenterVertical from '@phosphor/align-center-vertical.svg';
import AlignLeft from '@phosphor/align-left.svg';
import AlignRight from '@phosphor/align-right.svg';
import AlignTop from '@phosphor/align-top.svg';
import Angle from '@phosphor/angle.svg';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import FlipHorizontal from '@phosphor/flip-horizontal.svg';
import FlipVertical from '@phosphor/flip-vertical.svg';
import LockKey from '@phosphor/lock-key.svg';
import LockKeyOpen from '@phosphor/lock-key-open.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { Alignment } from '../core/align';
import { formatMeasure } from '../core/measure';
import type { Patch } from '../primitives/create-fig-editor';
import {
  AutoLayoutControls,
  ConstraintControls,
  SizingControl,
} from './auto-layout-controls';
import { NumberField } from './design-fields';
import { Section } from './panel-section';
import { TextResizing } from './text-resizing';

const ALIGNMENTS: {
  how: Alignment;
  label: string;
  icon: (props: { class?: string }) => JSX.Element;
}[] = [
  { how: 'left', label: 'Align left', icon: AlignLeft },
  {
    how: 'center',
    label: 'Align horizontal centers',
    icon: AlignCenterHorizontal,
  },
  { how: 'right', label: 'Align right', icon: AlignRight },
  { how: 'top', label: 'Align top', icon: AlignTop },
  { how: 'middle', label: 'Align vertical centers', icon: AlignCenterVertical },
  { how: 'bottom', label: 'Align bottom', icon: AlignBottom },
];

export function AlignRow(props: { onAlign: (how: Alignment) => void }) {
  return (
    <div class="grid grid-cols-2 gap-2">
      <For each={[ALIGNMENTS.slice(0, 3), ALIGNMENTS.slice(3)]}>
        {(group) => (
          <div class="flex rounded-md bg-inset">
            <For each={group}>
              {(item) => (
                <button
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                  data-testid={`fig-align-${item.how}`}
                  class="flex h-6 min-w-0 flex-1 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
                  onClick={() => props.onAlign(item.how)}
                >
                  {item.icon({ class: 'size-4' })}
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

function GeometryField(props: {
  label: string | JSX.Element;
  name: string;
  value: number;
  testId: string;
  min?: number;
  suffix?: JSX.Element;
  onChange?: (value: number, live: boolean) => void;
}) {
  return (
    <Show
      when={props.onChange}
      fallback={
        <div
          class="flex h-6 items-center gap-2 rounded bg-inset px-2"
          title={props.name}
        >
          <span class="text-ink-muted">{props.label}</span>
          <span>{formatMeasure(props.value)}</span>
        </div>
      }
    >
      {(change) => (
        <NumberField
          label={props.label}
          ariaLabel={props.name}
          value={props.value}
          min={props.min}
          suffix={props.suffix}
          testId={props.testId}
          onChange={change()}
        />
      )}
    </Show>
  );
}

export function PositionSection(props: {
  info: NodeInfo;
  onPatch?: (patch: Patch, live: boolean) => void;
  onAlign?: (how: Alignment) => void;
  onFlip?: (axis: 'horizontal' | 'vertical') => void;
}) {
  return (
    <Section title="Position" testId="fig-position-section">
      <Show when={props.onPatch && props.onAlign}>
        {(align) => (
          <>
            <span class="text-ink-muted text-[11px]">Alignment</span>
            <AlignRow onAlign={align()} />
          </>
        )}
      </Show>
      <span class="mt-1 text-ink-muted text-[11px]">Position</span>
      <div class="grid grid-cols-2 gap-2">
        <GeometryField
          label="X"
          name="X position"
          value={props.info.x}
          testId="fig-field-x"
          onChange={
            props.onPatch && ((x, live) => props.onPatch?.({ x }, live))
          }
        />
        <GeometryField
          label="Y"
          name="Y position"
          value={props.info.y}
          testId="fig-field-y"
          onChange={
            props.onPatch && ((y, live) => props.onPatch?.({ y }, live))
          }
        />
        <span class="col-span-2 text-ink-muted text-[11px]">Rotation</span>
        <GeometryField
          label={<Angle class="size-3.5" />}
          name="Rotation"
          value={props.info.rotation}
          testId="fig-field-rotation"
          onChange={
            props.onPatch &&
            ((rotation, live) => props.onPatch?.({ rotation }, live))
          }
        />
        <Show when={props.onPatch && props.onFlip}>
          <div class="flex items-center rounded-md bg-inset">
            <button
              type="button"
              aria-label="Rotate 90 degrees"
              title="Rotate 90 degrees"
              data-testid="fig-rotate-90"
              class="flex h-6 flex-1 items-center justify-center rounded hover:bg-hover"
              onClick={() =>
                props.onPatch?.(
                  { rotation: (props.info.rotation + 90) % 360 },
                  false
                )
              }
            >
              <ArrowClockwise class="size-4" />
            </button>
            <button
              type="button"
              aria-label="Flip horizontal"
              title="Flip horizontal · ⇧H"
              data-testid="fig-flip-horizontal"
              class="flex h-6 flex-1 items-center justify-center rounded hover:bg-hover"
              onClick={() => props.onFlip?.('horizontal')}
            >
              <FlipHorizontal class="size-4" />
            </button>
            <button
              type="button"
              aria-label="Flip vertical"
              title="Flip vertical · ⇧V"
              data-testid="fig-flip-vertical"
              class="flex h-6 flex-1 items-center justify-center rounded hover:bg-hover"
              onClick={() => props.onFlip?.('vertical')}
            >
              <FlipVertical class="size-4" />
            </button>
          </div>
        </Show>
      </div>
      <Show when={props.onPatch && props.info.layoutParent}>
        <label class="mt-1 flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={props.info.layoutParent === 'ABSOLUTE'}
            data-testid="fig-absolute"
            onChange={(e) =>
              props.onPatch?.(
                {
                  layoutPositioning: e.currentTarget.checked
                    ? 'ABSOLUTE'
                    : 'AUTO',
                },
                false
              )
            }
          />
          Ignore auto layout
        </label>
      </Show>
      <Show when={!props.onPatch && props.info.constraints}>
        {(constraints) => (
          <div class="mt-1 text-ink-muted">
            Constraints: {constraints()[0].toLowerCase()} ·{' '}
            {constraints()[1].toLowerCase()}
          </div>
        )}
      </Show>
      <Show when={props.onPatch && props.info.constrained}>
        <ConstraintControls
          constraints={props.info.constraints}
          onPatch={(patch) => props.onPatch?.(patch, false)}
        />
      </Show>
    </Section>
  );
}

function LayoutDimensions(props: {
  info: NodeInfo;
  onPatch?: (patch: Patch, live: boolean) => void;
}) {
  // This constrains inspector edits; it does not change the layer's layout mode.
  const [locked, setLocked] = createSignal(false);
  const resize = (axis: 'width' | 'height', value: number, live: boolean) => {
    const patch: Patch = { [axis]: value };
    if (locked() && props.info.width > 0 && props.info.height > 0) {
      if (axis === 'width')
        patch.height = (value * props.info.height) / props.info.width;
      else patch.width = (value * props.info.width) / props.info.height;
    }
    props.onPatch?.(patch, live);
  };
  return (
    <>
      <Show when={props.info.text && props.onPatch}>
        <span class="text-ink-muted text-[11px]">
          {props.info.autoLayout ? 'Resizing' : 'Dimensions'}
        </span>
        <TextResizing text={props.info.text!} onPatch={props.onPatch!} />
      </Show>
      <div class="flex items-center justify-between text-ink-muted text-[11px]">
        <span>{props.info.autoLayout ? 'Resizing' : 'Dimensions'}</span>
        <Show when={props.onPatch && !props.info.text}>
          <button
            type="button"
            aria-label="Lock aspect ratio"
            aria-pressed={locked()}
            title={locked() ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            data-testid="fig-lock-aspect-ratio"
            class="flex size-5 items-center justify-center rounded hover:bg-hover hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
            onClick={() => setLocked((value) => !value)}
          >
            <Show when={locked()} fallback={<LockKeyOpen class="size-3.5" />}>
              <LockKey class="size-3.5" />
            </Show>
          </button>
        </Show>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <GeometryField
          label="W"
          name="Width"
          value={props.info.width}
          min={0.01}
          testId="fig-field-w"
          suffix={
            props.onPatch &&
            (!props.info.text || props.info.layoutParent === 'AUTO') && (
              <SizingControl
                info={props.info}
                axis={0}
                onPatch={props.onPatch}
              />
            )
          }
          onChange={
            props.onPatch && ((width, live) => resize('width', width, live))
          }
        />
        <GeometryField
          label="H"
          name="Height"
          value={props.info.height}
          min={0.01}
          testId="fig-field-h"
          suffix={
            props.onPatch &&
            (!props.info.text || props.info.layoutParent === 'AUTO') && (
              <SizingControl
                info={props.info}
                axis={1}
                onPatch={props.onPatch}
              />
            )
          }
          onChange={
            props.onPatch && ((height, live) => resize('height', height, live))
          }
        />
      </div>
    </>
  );
}

export function LayoutSection(props: {
  info: NodeInfo;
  onPatch?: (patch: Patch, live: boolean) => void;
  onAddAutoLayout?: () => void;
}) {
  const editableLayout = () => {
    const layout = props.info.autoLayout;
    return props.onPatch &&
      layout &&
      ['HORIZONTAL', 'VERTICAL'].includes(layout.mode) &&
      !layout.wrap
      ? layout
      : undefined;
  };
  return (
    <Section
      title={props.info.autoLayout ? 'Auto layout' : 'Layout'}
      testId="fig-auto-layout-section"
      onAdd={
        !props.info.autoLayout && ['FRAME', 'SYMBOL'].includes(props.info.type)
          ? props.onAddAutoLayout
          : undefined
      }
      addLabel="Add auto layout"
      onRemove={
        props.info.autoLayout && props.onPatch
          ? () => props.onPatch?.({ layoutMode: 'NONE' }, false)
          : undefined
      }
    >
      <Show
        when={editableLayout()}
        fallback={
          <>
            <LayoutDimensions info={props.info} onPatch={props.onPatch} />
            <Show when={props.info.autoLayout}>
              {(layout) => (
                <div class="text-ink-muted">
                  {layout().mode.toLowerCase()} · Gap{' '}
                  {formatMeasure(layout().spacing)} · Padding{' '}
                  {[
                    layout().paddingTop,
                    layout().paddingRight,
                    layout().paddingBottom,
                    layout().paddingLeft,
                  ]
                    .map(formatMeasure)
                    .join(' ')}
                </div>
              )}
            </Show>
          </>
        }
      >
        {(layout) => (
          <AutoLayoutControls
            layout={layout()}
            onPatch={(patch, live) => props.onPatch?.(patch, live)}
          >
            <LayoutDimensions info={props.info} onPatch={props.onPatch} />
          </AutoLayoutControls>
        )}
      </Show>
      <Show when={props.info.type === 'FRAME'}>
        <label class="mt-1 flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={props.info.clipsContent}
            disabled={!props.onPatch}
            data-testid="fig-clip-content"
            onChange={(e) =>
              props.onPatch?.({ clipContent: e.currentTarget.checked }, false)
            }
          />
          Clip content
        </label>
      </Show>
    </Section>
  );
}
