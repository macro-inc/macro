/**
 * Illustrator's Properties panel for the selection: Transform (position,
 * size, rotation, flips), Appearance (fill, stroke, opacity, blending),
 * Stroke details, Character and Paragraph for text, Align, Pathfinder, and
 * Quick Actions; with nothing selected, the artboard. Read-only viewers
 * see the same values. Presentational.
 */

import {
  ChoiceRow,
  NumberField,
  TextField,
} from '@app/features/block-fig/components/design-fields';
import { FontPicker } from '@app/features/block-fig/components/font-picker';
import { Section } from '@app/features/block-fig/components/panel-section';
import type { Alignment } from '@app/features/block-fig/core/align';
import AlignBottom from '@phosphor/align-bottom.svg';
import AlignCenterHorizontal from '@phosphor/align-center-horizontal.svg';
import AlignCenterVertical from '@phosphor/align-center-vertical.svg';
import AlignLeft from '@phosphor/align-left.svg';
import AlignRight from '@phosphor/align-right.svg';
import AlignTop from '@phosphor/align-top.svg';
import ArrowFatDown from '@phosphor/arrow-fat-down.svg';
import ArrowFatLineDown from '@phosphor/arrow-fat-line-down.svg';
import ArrowFatLineUp from '@phosphor/arrow-fat-line-up.svg';
import ArrowFatUp from '@phosphor/arrow-fat-up.svg';
import ArrowsDownUp from '@phosphor/arrows-down-up.svg';
import ArrowsLeftRight from '@phosphor/arrows-left-right.svg';
import Exclude from '@phosphor/exclude.svg';
import FlipHorizontal from '@phosphor/flip-horizontal.svg';
import FlipVertical from '@phosphor/flip-vertical.svg';
import Intersect from '@phosphor/intersect.svg';
import Subtract from '@phosphor/subtract.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import Unite from '@phosphor/unite.svg';
import { Button } from '@ui/components/Button';
import { type Component, For, type JSX, Show } from 'solid-js';
import type { Rect } from '../core/geometry';
import type { Arrangement } from '../core/layers';
import {
  formatDash,
  type LineCap,
  type LineJoin,
  parseDash,
} from '../core/paint';
import { PaintSwatch } from './paint-swatch';

type Icon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

export const BLEND_LABELS: Record<string, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  colorDodge: 'Color Dodge',
  colorBurn: 'Color Burn',
  hardLight: 'Hard Light',
  softLight: 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/** A paint as the panel shows it. */
export interface PanelPaint {
  css: string;
  hex: string;
  none: boolean;
  /** Its kind and color: `#FF0000`, `CMYK 0/100/100/0`, a gradient… */
  label: string;
  gradient: boolean;
  /** The selected objects' paints differ. */
  mixed: boolean;
}

export interface PanelText {
  family: string;
  style: string;
  styles: string[];
  size: number;
  tracking: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  /** Area text's width (point text: `null`). */
  width: number | null;
  /** Still the file's glyphs (laid out again on the first change). */
  fromFile: boolean;
  missing: boolean;
}

export interface PanelModel {
  /** What is selected: `Path`, `Text`, `3 Objects`… */
  title: string;
  count: number;
  bounds?: Rect;
  rotation?: number;
  fill?: PanelPaint;
  stroke?: PanelPaint & {
    width: number;
    cap: LineCap;
    join: LineJoin;
    dash: number[];
  };
  opacity?: { value: number; mixed: boolean };
  blend?: string;
  text?: PanelText;
  /** Group-like and path actions available for the selection. */
  can: {
    group: boolean;
    ungroup: boolean;
    clip: boolean;
    release: boolean;
    outline: boolean;
    pathfinder: boolean;
    distribute: boolean;
  };
  /** With nothing selected: the artboard. */
  artboard?: { name: string; rect: Rect };
}

export interface PanelActions {
  onBounds: (patch: Partial<Rect>, live: boolean) => void;
  onRotation: (degrees: number, live: boolean) => void;
  onFlip: (vertical: boolean) => void;
  onFill: (hex: string | null, live: boolean) => void;
  onStroke: (hex: string | null, live: boolean) => void;
  onStrokeProps: (
    patch: { width?: number; cap?: LineCap; join?: LineJoin; dash?: number[] },
    live: boolean
  ) => void;
  onOpacity: (value: number, live: boolean) => void;
  onBlend: (mode: string) => void;
  onText: (
    patch: {
      family?: string;
      style?: string;
      size?: number;
      tracking?: number;
      lineHeight?: number;
      align?: 'left' | 'center' | 'right';
    },
    live: boolean
  ) => void;
  onAlign: (how: Alignment) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onBoolean: (mode: 'unite' | 'subtract' | 'intersect' | 'exclude') => void;
  onArrange: (how: Arrangement) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onClip: () => void;
  onRelease: () => void;
  onOutline: () => void;
  onArtboard: (patch: { name?: string; rect?: Rect }) => void;
}

export interface PanelFonts {
  documentFamilies: readonly string[];
  googleFamilies: readonly string[];
  preview?: (family: string) => Promise<string | undefined>;
  onOpen?: () => void;
}

function IconButton(props: {
  label: string;
  icon: Icon;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      label={props.label}
      tooltip={props.label}
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <props.icon />
    </Button>
  );
}

/** A paint row: swatch (picker), hex field, and what it is. */
function PaintRow(props: {
  name: 'fill' | 'stroke';
  paint: PanelPaint;
  editable: boolean;
  onChange: (hex: string | null, live: boolean) => void;
  extra?: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <PaintSwatch
        swatch={props.paint.css}
        hex={props.paint.hex}
        none={props.paint.none}
        ring={props.name === 'stroke'}
        label={props.name === 'fill' ? 'Fill color' : 'Stroke color'}
        testId={`ai-${props.name}-swatch`}
        disabled={!props.editable}
        onChange={props.onChange}
      />
      <Show
        when={props.editable && !props.paint.gradient}
        fallback={
          <span
            class="min-w-0 flex-1 truncate text-ink-muted"
            data-testid={`ai-${props.name}-label`}
            title={props.paint.label}
          >
            {props.paint.mixed ? 'Mixed' : props.paint.label}
          </span>
        }
      >
        <div class="flex min-w-0 flex-1 items-center rounded-md bg-inset px-1">
          <span class="text-ink-muted">#</span>
          <TextField
            value={
              props.paint.mixed
                ? 'Mixed'
                : props.paint.none
                  ? 'None'
                  : props.paint.hex
            }
            class="font-mono uppercase"
            testId={`ai-${props.name}-hex`}
            onChange={(v) => {
              const t = v.trim().toLowerCase();
              props.onChange(t === 'none' || t === '' ? null : v, false);
            }}
          />
        </div>
      </Show>
      {props.extra}
    </div>
  );
}

const ALIGN: { how: Alignment; label: string; icon: Icon }[] = [
  { how: 'left', label: 'Align left', icon: AlignLeft },
  {
    how: 'center',
    label: 'Align horizontal center',
    icon: AlignCenterHorizontal,
  },
  { how: 'right', label: 'Align right', icon: AlignRight },
  { how: 'top', label: 'Align top', icon: AlignTop },
  { how: 'middle', label: 'Align vertical center', icon: AlignCenterVertical },
  { how: 'bottom', label: 'Align bottom', icon: AlignBottom },
];

const PATHFINDER: {
  mode: 'unite' | 'subtract' | 'intersect' | 'exclude';
  label: string;
  icon: Icon;
}[] = [
  { mode: 'unite', label: 'Unite', icon: Unite },
  { mode: 'subtract', label: 'Minus front', icon: Subtract },
  { mode: 'intersect', label: 'Intersect', icon: Intersect },
  { mode: 'exclude', label: 'Exclude', icon: Exclude },
];

const ARRANGE: { how: Arrangement; label: string; icon: Icon }[] = [
  { how: 'front', label: 'Bring to front (⇧⌘])', icon: ArrowFatLineUp },
  { how: 'forward', label: 'Bring forward (⌘])', icon: ArrowFatUp },
  { how: 'backward', label: 'Send backward (⌘[)', icon: ArrowFatDown },
  { how: 'back', label: 'Send to back (⇧⌘[)', icon: ArrowFatLineDown },
];

const round = (v: number) => Math.round(v * 100) / 100;

function TransformSection(props: {
  bounds: Rect;
  rotation?: number;
  editable: boolean;
  actions: PanelActions;
}) {
  const field = (label: string, key: keyof Rect, min?: number) => (
    <NumberField
      label={label}
      value={round(props.bounds[key])}
      min={min}
      testId={`ai-field-${key}`}
      onChange={(v, live) =>
        props.editable && props.actions.onBounds({ [key]: v }, live)
      }
    />
  );
  return (
    <Section title="Transform" testId="ai-transform">
      <div class="grid grid-cols-2 gap-1.5">
        {field('X', 'x')}
        {field('Y', 'y')}
        {field('W', 'w', 0.01)}
        {field('H', 'h', 0.01)}
      </div>
      <div class="flex items-center gap-1.5">
        <div class="flex-1">
          <NumberField
            label="∠"
            value={props.rotation ?? 0}
            testId="ai-field-rotation"
            onChange={(v, live) =>
              props.editable && props.actions.onRotation(v, live)
            }
          />
        </div>
        <IconButton
          label="Flip horizontal"
          icon={FlipHorizontal}
          testId="ai-flip-horizontal"
          disabled={!props.editable}
          onClick={() => props.actions.onFlip(false)}
        />
        <IconButton
          label="Flip vertical"
          icon={FlipVertical}
          testId="ai-flip-vertical"
          disabled={!props.editable}
          onClick={() => props.actions.onFlip(true)}
        />
      </div>
    </Section>
  );
}

function StrokeDetails(props: {
  stroke: NonNullable<PanelModel['stroke']>;
  editable: boolean;
  actions: PanelActions;
}) {
  return (
    <>
      <div class="grid grid-cols-2 gap-1.5">
        <ChoiceRow
          value={props.stroke.cap}
          testId="ai-stroke-cap"
          options={[
            {
              value: 'butt',
              label: 'Butt cap',
              icon: <span class="text-[10px]">Butt</span>,
            },
            {
              value: 'round',
              label: 'Round cap',
              icon: <span class="text-[10px]">Round</span>,
            },
            {
              value: 'square',
              label: 'Projecting cap',
              icon: <span class="text-[10px]">Proj</span>,
            },
          ]}
          onChange={(cap) =>
            props.editable && props.actions.onStrokeProps({ cap }, false)
          }
        />
        <ChoiceRow
          value={props.stroke.join}
          testId="ai-stroke-join"
          options={[
            {
              value: 'miter',
              label: 'Miter join',
              icon: <span class="text-[10px]">Miter</span>,
            },
            {
              value: 'round',
              label: 'Round join',
              icon: <span class="text-[10px]">Round</span>,
            },
            {
              value: 'bevel',
              label: 'Bevel join',
              icon: <span class="text-[10px]">Bevel</span>,
            },
          ]}
          onChange={(join) =>
            props.editable && props.actions.onStrokeProps({ join }, false)
          }
        />
      </div>
      <label class="flex min-w-0 items-center gap-2 rounded-md bg-inset px-2 py-1">
        <span class="shrink-0 text-ink-muted">Dash</span>
        <TextField
          value={formatDash(props.stroke.dash)}
          testId="ai-field-dash"
          onChange={(v) => {
            const dash = parseDash(v);
            if (dash && props.editable)
              props.actions.onStrokeProps({ dash }, false);
          }}
        />
      </label>
    </>
  );
}

function TextSections(props: {
  text: PanelText;
  editable: boolean;
  fonts: PanelFonts;
  actions: PanelActions;
}) {
  return (
    <>
      <Section title="Character" testId="ai-character">
        <FontPicker
          value={props.text.family}
          documentFamilies={props.fonts.documentFamilies}
          googleFamilies={props.fonts.googleFamilies}
          missing={props.text.missing}
          preview={props.fonts.preview}
          onOpen={props.fonts.onOpen}
          onSelect={(family) =>
            props.editable && props.actions.onText({ family }, false)
          }
        />
        <div class="grid grid-cols-2 gap-1.5">
          <select
            aria-label="Font style"
            data-testid="ai-font-style"
            class="min-w-0 rounded-md bg-inset px-1.5 py-1 text-ink outline-none"
            value={props.text.style}
            disabled={!props.editable}
            onChange={(e) =>
              props.actions.onText({ style: e.currentTarget.value }, false)
            }
          >
            <For
              each={
                props.text.styles.includes(props.text.style)
                  ? props.text.styles
                  : [props.text.style, ...props.text.styles]
              }
            >
              {(s) => <option value={s}>{s}</option>}
            </For>
          </select>
          <NumberField
            label="pt"
            value={round(props.text.size)}
            min={0.1}
            testId="ai-field-font-size"
            onChange={(size, live) =>
              props.editable && props.actions.onText({ size }, live)
            }
          />
          <NumberField
            label="VA"
            value={round(props.text.tracking)}
            testId="ai-field-tracking"
            onChange={(tracking, live) =>
              props.editable && props.actions.onText({ tracking }, live)
            }
          />
          <NumberField
            label="↕"
            value={round(props.text.lineHeight * 100)}
            min={10}
            testId="ai-field-line-height"
            onChange={(v, live) =>
              props.editable &&
              props.actions.onText({ lineHeight: v / 100 }, live)
            }
          />
        </div>
        <Show when={props.text.fromFile}>
          <p class="text-ink-muted" data-testid="ai-text-from-file">
            Shown as the file set it; changing it lays it out again.
          </p>
        </Show>
      </Section>
      <Section title="Paragraph" testId="ai-paragraph">
        <ChoiceRow
          value={props.text.align}
          testId="ai-text-align"
          options={[
            {
              value: 'left',
              label: 'Align left',
              icon: <TextAlignLeft class="size-3.5" />,
            },
            {
              value: 'center',
              label: 'Align center',
              icon: <TextAlignCenter class="size-3.5" />,
            },
            {
              value: 'right',
              label: 'Align right',
              icon: <TextAlignRight class="size-3.5" />,
            },
          ]}
          onChange={(align) =>
            props.editable && props.actions.onText({ align }, false)
          }
        />
      </Section>
    </>
  );
}

export function PropertiesPanel(props: {
  model: PanelModel;
  editable: boolean;
  fonts: PanelFonts;
  actions: PanelActions;
}) {
  const m = () => props.model;
  const a = props.actions;
  return (
    <div
      class="flex min-h-0 flex-1 flex-col overflow-y-auto text-ink text-xs"
      data-testid="ai-properties"
    >
      <div class="flex h-8 shrink-0 items-center border-edge-muted border-b px-3 font-semibold">
        <span data-testid="ai-selection-title">{m().title}</span>
      </div>
      <Show when={m().count === 0 && m().artboard}>
        {(board) => (
          <Section title="Artboard" testId="ai-artboard-section">
            <div class="flex items-center rounded-md bg-inset px-1">
              <TextField
                value={board().name}
                testId="ai-artboard-name"
                onChange={(name) => props.editable && a.onArtboard({ name })}
              />
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={['x', 'y', 'w', 'h'] as const}>
                {(key) => (
                  <NumberField
                    label={key.toUpperCase()}
                    value={round(board().rect[key])}
                    min={key === 'w' || key === 'h' ? 1 : undefined}
                    testId={`ai-artboard-${key}`}
                    onChange={(v) =>
                      props.editable &&
                      a.onArtboard({ rect: { ...board().rect, [key]: v } })
                    }
                  />
                )}
              </For>
            </div>
          </Section>
        )}
      </Show>
      <Show when={m().count > 0 && m().bounds}>
        {(bounds) => (
          <TransformSection
            bounds={bounds()}
            rotation={m().rotation}
            editable={props.editable}
            actions={a}
          />
        )}
      </Show>
      <Show when={m().count > 0}>
        <Section title="Appearance" testId="ai-appearance">
          <Show when={m().fill}>
            {(fill) => (
              <PaintRow
                name="fill"
                paint={fill()}
                editable={props.editable}
                onChange={a.onFill}
              />
            )}
          </Show>
          <Show when={m().stroke}>
            {(stroke) => (
              <PaintRow
                name="stroke"
                paint={stroke()}
                editable={props.editable}
                onChange={a.onStroke}
                extra={
                  <div class="w-20 shrink-0">
                    <NumberField
                      label="pt"
                      value={round(stroke().width)}
                      min={0}
                      testId="ai-field-stroke-width"
                      onChange={(width, live) =>
                        props.editable && a.onStrokeProps({ width }, live)
                      }
                    />
                  </div>
                }
              />
            )}
          </Show>
          <Show when={m().stroke && !m().stroke?.none}>
            <StrokeDetails
              stroke={m().stroke as NonNullable<PanelModel['stroke']>}
              editable={props.editable}
              actions={a}
            />
          </Show>
          <Show when={m().opacity}>
            {(opacity) => (
              <div class="grid grid-cols-2 gap-1.5">
                <NumberField
                  label="Opacity"
                  value={opacity().value}
                  percent
                  min={0}
                  max={1}
                  mixed={opacity().mixed}
                  testId="ai-field-opacity"
                  onChange={(v, live) => props.editable && a.onOpacity(v, live)}
                />
                <select
                  aria-label="Blending mode"
                  data-testid="ai-blend"
                  class="min-w-0 rounded-md bg-inset px-1.5 py-1 text-ink outline-none"
                  value={m().blend ?? 'normal'}
                  disabled={!props.editable}
                  onChange={(e) => a.onBlend(e.currentTarget.value)}
                >
                  <For each={Object.entries(BLEND_LABELS)}>
                    {([value, label]) => <option value={value}>{label}</option>}
                  </For>
                </select>
              </div>
            )}
          </Show>
        </Section>
      </Show>
      <Show when={m().text}>
        {(text) => (
          <TextSections
            text={text()}
            editable={props.editable}
            fonts={props.fonts}
            actions={a}
          />
        )}
      </Show>
      <Show when={m().count > 0 && props.editable}>
        <Section title="Align" testId="ai-align">
          <div class="flex flex-wrap items-center gap-0.5">
            <For each={ALIGN}>
              {(item) => (
                <IconButton
                  label={item.label}
                  icon={item.icon}
                  testId={`ai-align-${item.how}`}
                  onClick={() => a.onAlign(item.how)}
                />
              )}
            </For>
            <IconButton
              label="Distribute horizontal spacing"
              icon={ArrowsLeftRight}
              testId="ai-distribute-horizontal"
              disabled={!m().can.distribute}
              onClick={() => a.onDistribute('horizontal')}
            />
            <IconButton
              label="Distribute vertical spacing"
              icon={ArrowsDownUp}
              testId="ai-distribute-vertical"
              disabled={!m().can.distribute}
              onClick={() => a.onDistribute('vertical')}
            />
          </div>
        </Section>
        <Show when={m().can.pathfinder}>
          <Section title="Pathfinder" testId="ai-pathfinder">
            <div class="flex items-center gap-0.5">
              <For each={PATHFINDER}>
                {(item) => (
                  <IconButton
                    label={item.label}
                    icon={item.icon}
                    testId={`ai-pathfinder-${item.mode}`}
                    onClick={() => a.onBoolean(item.mode)}
                  />
                )}
              </For>
            </div>
          </Section>
        </Show>
        <Section title="Quick actions" testId="ai-quick-actions">
          <div class="flex items-center gap-0.5">
            <For each={ARRANGE}>
              {(item) => (
                <IconButton
                  label={item.label}
                  icon={item.icon}
                  testId={`ai-arrange-${item.how}`}
                  onClick={() => a.onArrange(item.how)}
                />
              )}
            </For>
          </div>
          <div class="flex flex-wrap gap-1">
            <Show when={m().can.group}>
              <Button
                variant="outline"
                size="sm"
                data-testid="ai-action-group"
                onClick={() => a.onGroup()}
              >
                Group
              </Button>
            </Show>
            <Show when={m().can.ungroup}>
              <Button
                variant="outline"
                size="sm"
                data-testid="ai-action-ungroup"
                onClick={() => a.onUngroup()}
              >
                Ungroup
              </Button>
            </Show>
            <Show when={m().can.clip}>
              <Button
                variant="outline"
                size="sm"
                data-testid="ai-action-clip"
                onClick={() => a.onClip()}
              >
                Make clipping mask
              </Button>
            </Show>
            <Show when={m().can.release}>
              <Button
                variant="outline"
                size="sm"
                data-testid="ai-action-release"
                onClick={() => a.onRelease()}
              >
                Release clipping mask
              </Button>
            </Show>
            <Show when={m().can.outline}>
              <Button
                variant="outline"
                size="sm"
                data-testid="ai-action-outline"
                onClick={() => a.onOutline()}
              >
                Create outlines
              </Button>
            </Show>
          </div>
        </Section>
      </Show>
    </div>
  );
}
