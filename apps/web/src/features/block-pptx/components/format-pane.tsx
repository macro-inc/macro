/**
 * The format pane, docked right of the slide as in PowerPoint: fill and
 * line, size and position, text box and paragraph settings, and the slide
 * background.
 */

import { Popover } from '@kobalte/core/popover';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { boxOf } from '../core/geometry';
import { swatchCss } from '../core/palette';
import { unionBounds } from '../core/selection';
import { ColorPicker, NumberField } from './ribbon/controls';
import type { RibbonEnv } from './ribbon/ribbon';

export type PaneSection = 'shape' | 'size' | 'text' | 'background';

function Section(props: {
  title: string;
  children: JSX.Element;
  open?: boolean;
}) {
  const [open, setOpen] = createSignal(props.open ?? true);
  return (
    <div class="border-edge-muted border-b py-2">
      <button
        type="button"
        class="flex w-full items-center gap-1 px-3 py-1 font-semibold text-ink text-xs"
        aria-expanded={open()}
        onClick={() => setOpen((o) => !o)}
      >
        <span class="inline-block w-3 text-ink-muted">
          {open() ? '▾' : '▸'}
        </span>
        {props.title}
      </button>
      <Show when={open()}>
        <div class="flex flex-col gap-2 px-3 pt-1 pb-1">{props.children}</div>
      </Show>
    </div>
  );
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-2 text-xs">
      <span class="text-ink-muted">{props.label}</span>
      <div class="flex items-center gap-1">{props.children}</div>
    </div>
  );
}

function Choice<T extends string>(props: {
  name: string;
  value: T | undefined;
  options: [T, string][];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div class="flex flex-col gap-1" role="radiogroup" aria-label={props.name}>
      <For each={props.options}>
        {([value, label]) => (
          <label class="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name={props.name}
              class="accent-accent"
              disabled={props.disabled}
              checked={props.value === value}
              onChange={() => props.onChange(value)}
            />
            {label}
          </label>
        )}
      </For>
    </div>
  );
}

function Select(props: {
  label: string;
  value: string | undefined;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={props.label}
      class="h-7 rounded-md border border-edge-muted bg-input px-1 text-ink text-xs"
      disabled={props.disabled}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      <Show when={props.value === undefined}>
        <option value="" disabled>
          —
        </option>
      </Show>
      <For each={props.options}>
        {([value, label]) => <option value={value}>{label}</option>}
      </For>
    </select>
  );
}

/** A swatch button opening the color picker. */
function ColorButton(props: {
  env: RibbonEnv;
  label: string;
  value: string | undefined;
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const css = () =>
    swatchCss(props.value, props.env.deck()?.themeColors ?? []) ??
    'transparent';
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={4}
    >
      <Popover.Trigger
        class="flex h-7 items-center gap-1 rounded-md border border-edge-muted bg-input px-1.5 text-xs disabled:opacity-50"
        aria-label={props.label}
        disabled={props.disabled}
      >
        <span
          class="size-4 rounded-sm border border-edge-muted"
          style={{ background: css() }}
        />
        <span class="text-ink-muted">▾</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu rounded-xl border border-edge bg-menu p-2 shadow-xl outline-none">
          <ColorPicker
            themeGrid={props.env.themeGrid()}
            standard={props.env.standardColors}
            onPick={(v) => {
              setOpen(false);
              if (v) props.onPick(v);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function FillControls(props: {
  env: RibbonEnv;
  current?: string;
  apply: (fill: import('@core/pptx-engine/types').FillSpec | null) => void;
  allowReset?: boolean;
  disabled?: boolean;
}) {
  const [kind, setKind] = createSignal<'none' | 'solid' | 'gradient' | 'reset'>(
    props.current ? 'solid' : 'none'
  );
  const [color, setColor] = createSignal(
    props.current?.replace('#', '') ?? 'accent1'
  );
  const [transparency, setTransparency] = createSignal(0);
  const [stops, setStops] = createSignal<[string, string]>(['accent1', 'bg1']);
  const [angle, setAngle] = createSignal(90);
  const solid = () =>
    props.apply({
      kind: 'solid',
      color: color(),
      ...(transparency() > 0 ? { alpha: 1 - transparency() / 100 } : {}),
    });
  const gradient = () =>
    props.apply({ kind: 'gradient', colors: [...stops()], angle: angle() });
  return (
    <>
      <Choice
        name="fill"
        disabled={props.disabled}
        value={kind()}
        options={[
          ...(props.allowReset
            ? ([['reset', 'Layout background']] as ['reset', string][])
            : []),
          ['none', 'No fill'],
          ['solid', 'Solid fill'],
          ['gradient', 'Gradient fill'],
        ]}
        onChange={(k) => {
          setKind(k);
          if (k === 'none') props.apply({ kind: 'none' });
          else if (k === 'reset') props.apply(null);
          else if (k === 'solid') solid();
          else gradient();
        }}
      />
      <Show when={kind() === 'solid'}>
        <Row label="Color">
          <ColorButton
            env={props.env}
            label="Fill color"
            value={color()}
            disabled={props.disabled}
            onPick={(v) => {
              setColor(v);
              solid();
            }}
          />
        </Row>
        <Row label="Transparency">
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Transparency"
            class="w-24 accent-accent"
            value={transparency()}
            disabled={props.disabled}
            onInput={(e) => setTransparency(Number(e.currentTarget.value))}
            onChange={solid}
          />
          <span class="w-8 text-right tabular-nums">{transparency()}%</span>
        </Row>
      </Show>
      <Show when={kind() === 'gradient'}>
        <Row label="Start color">
          <ColorButton
            env={props.env}
            label="Gradient start"
            value={stops()[0]}
            disabled={props.disabled}
            onPick={(v) => {
              setStops([v, stops()[1]]);
              gradient();
            }}
          />
        </Row>
        <Row label="End color">
          <ColorButton
            env={props.env}
            label="Gradient end"
            value={stops()[1]}
            disabled={props.disabled}
            onPick={(v) => {
              setStops([stops()[0], v]);
              gradient();
            }}
          />
        </Row>
        <Row label="Angle">
          <NumberField
            label="Gradient angle"
            unit="°"
            value={angle()}
            min={0}
            max={359}
            disabled={props.disabled}
            onCommit={(v) => {
              setAngle(v);
              gradient();
            }}
          />
        </Row>
      </Show>
    </>
  );
}

export function FormatPane(props: {
  section: PaneSection;
  onSection: (section: PaneSection) => void;
  onClose: () => void;
  env: RibbonEnv;
}) {
  const env = props.env;
  const c = env.commands;
  const ro = () => env.readonly();
  const shapes = () => env.selection();
  const one = () => (shapes().length === 1 ? shapes()[0] : undefined);
  const bounds = () => {
    const b = unionBounds(shapes().map(boxOf));
    return b;
  };
  const [lockAspect, setLockAspect] = createSignal(false);
  const [lineKind, setLineKind] = createSignal<'none' | 'solid' | undefined>();
  const title = () =>
    props.section === 'background'
      ? 'Format background'
      : props.section === 'text'
        ? 'Format text'
        : 'Format shape';
  return (
    <aside
      class="flex w-72 shrink-0 flex-col border-edge-muted border-l bg-panel"
      data-testid="pptx-format-pane"
      aria-label={title()}
    >
      <div class="flex h-9 items-center justify-between border-edge-muted border-b px-3">
        <span class="font-semibold text-ink text-sm">{title()}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Close"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <Show when={props.section !== 'background'}>
        <div class="flex gap-1 border-edge-muted border-b px-2 py-1.5">
          <For
            each={
              [
                ['shape', 'Fill & line'],
                ['size', 'Size'],
                ['text', 'Text'],
              ] as [PaneSection, string][]
            }
          >
            {([section, label]) => (
              <button
                type="button"
                class="rounded-md px-2 py-1 text-xs"
                classList={{
                  'bg-accent-bg text-accent': props.section === section,
                  'text-ink-muted hover:bg-ink/5': props.section !== section,
                }}
                onClick={() => props.onSection(section)}
              >
                {label}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show when={props.section !== 'background' && shapes().length === 0}>
          <p class="p-3 text-ink-muted text-xs">Select a shape to format it.</p>
        </Show>
        <Show
          when={
            props.section === 'shape' && shapes().length > 0
              ? shapes()
                  .map((x) => x.id)
                  .join(',')
              : undefined
          }
          keyed
        >
          <Section title="Fill">
            <FillControls
              env={env}
              current={one()?.fill}
              disabled={ro()}
              apply={(fill) => fill && void c.setFill(fill)}
            />
          </Section>
          <Section title="Line">
            <Choice
              name="line"
              disabled={ro()}
              value={lineKind()}
              options={[
                ['none', 'No line'],
                ['solid', 'Solid line'],
              ]}
              onChange={(k) => {
                setLineKind(k);
                void c.setLine(k === 'none' ? { none: true } : { width: 1 });
              }}
            />
            <Row label="Color">
              <ColorButton
                env={env}
                label="Line color"
                value={undefined}
                disabled={ro()}
                onPick={(color) => {
                  setLineKind('solid');
                  void c.setLine({ color });
                }}
              />
            </Row>
            <Row label="Width">
              <NumberField
                label="Line width"
                unit="pt"
                value={undefined}
                min={0}
                max={100}
                step={0.25}
                precision={2}
                disabled={ro()}
                onCommit={(width) => void c.setLine({ width })}
              />
            </Row>
            <Row label="Dash type">
              <Select
                label="Dash type"
                value={undefined}
                disabled={ro()}
                options={[
                  ['solid', 'Solid'],
                  ['sysDot', 'Round dot'],
                  ['sysDash', 'Square dot'],
                  ['dash', 'Dash'],
                  ['dashDot', 'Dash dot'],
                  ['lgDash', 'Long dash'],
                  ['lgDashDot', 'Long dash dot'],
                ]}
                onChange={(dash) => void c.setLine({ dash })}
              />
            </Row>
            <Row label="Begin arrow">
              <Select
                label="Begin arrow"
                value={undefined}
                disabled={ro()}
                options={[
                  ['none', 'None'],
                  ['triangle', 'Arrow'],
                  ['stealth', 'Stealth'],
                  ['diamond', 'Diamond'],
                  ['oval', 'Oval'],
                  ['arrow', 'Open arrow'],
                ]}
                onChange={(head) => void c.setLine({ head })}
              />
            </Row>
            <Row label="End arrow">
              <Select
                label="End arrow"
                value={undefined}
                disabled={ro()}
                options={[
                  ['none', 'None'],
                  ['triangle', 'Arrow'],
                  ['stealth', 'Stealth'],
                  ['diamond', 'Diamond'],
                  ['oval', 'Oval'],
                  ['arrow', 'Open arrow'],
                ]}
                onChange={(tail) => void c.setLine({ tail })}
              />
            </Row>
          </Section>
        </Show>
        <Show when={props.section === 'size' && shapes().length > 0}>
          <Section title="Size">
            <Row label="Height">
              <NumberField
                label="Height"
                unit="pt"
                value={bounds()?.h}
                min={1}
                max={10000}
                disabled={ro()}
                testId="pptx-pane-height"
                onCommit={(h) => {
                  const b = bounds();
                  c.resize(
                    lockAspect() && b && b.h > 0
                      ? { h, w: (b.w * h) / b.h }
                      : { h }
                  );
                }}
              />
            </Row>
            <Row label="Width">
              <NumberField
                label="Width"
                unit="pt"
                value={bounds()?.w}
                min={1}
                max={10000}
                disabled={ro()}
                testId="pptx-pane-width"
                onCommit={(w) => {
                  const b = bounds();
                  c.resize(
                    lockAspect() && b && b.w > 0
                      ? { w, h: (b.h * w) / b.w }
                      : { w }
                  );
                }}
              />
            </Row>
            <Row label="Rotation">
              <NumberField
                label="Rotation"
                unit="°"
                value={one()?.rotation}
                min={-360}
                max={360}
                disabled={ro() || !one()}
                onCommit={(r) => void c.setRotation(r)}
              />
            </Row>
            <label class="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                class="accent-accent"
                checked={lockAspect()}
                onChange={(e) => setLockAspect(e.currentTarget.checked)}
              />
              Lock aspect ratio
            </label>
          </Section>
          <Show when={one()}>
            {(shape) => (
              <Section title="Alt text">
                <textarea
                  aria-label="Alt text"
                  data-testid="pptx-alt-text"
                  placeholder="Describe this object for people who can't see it"
                  class="h-20 resize-none rounded-md border border-edge-muted bg-input p-2 text-ink text-xs outline-none focus:border-accent"
                  disabled={ro()}
                  value={shape().altText ?? ''}
                  onKeyDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const text = e.currentTarget.value;
                    if (text !== (shape().altText ?? ''))
                      void c.setAltText(text);
                  }}
                />
              </Section>
            )}
          </Show>
          <Section title="Position">
            <Row label="Horizontal">
              <NumberField
                label="Horizontal position"
                unit="pt"
                value={one()?.x}
                min={-10000}
                max={10000}
                disabled={ro() || !one()}
                onCommit={(x) => void c.move({ x })}
              />
            </Row>
            <Row label="Vertical">
              <NumberField
                label="Vertical position"
                unit="pt"
                value={one()?.y}
                min={-10000}
                max={10000}
                disabled={ro() || !one()}
                onCommit={(y) => void c.move({ y })}
              />
            </Row>
          </Section>
        </Show>
        <Show when={props.section === 'text' && shapes().length > 0}>
          <Section title="Text box">
            <Row label="Vertical alignment">
              <Select
                label="Vertical alignment"
                value={undefined}
                disabled={ro()}
                options={[
                  ['top', 'Top'],
                  ['middle', 'Middle'],
                  ['bottom', 'Bottom'],
                ]}
                onChange={(anchor) =>
                  void c.body({ anchor: anchor as 'top' | 'middle' | 'bottom' })
                }
              />
            </Row>
            <Choice
              name="autofit"
              disabled={ro()}
              value={undefined}
              options={[
                ['none', 'Do not autofit'],
                ['shrink', 'Shrink text on overflow'],
                ['resize', 'Resize shape to fit text'],
              ]}
              onChange={(autofit) => void c.body({ autofit })}
            />
            <For
              each={
                [
                  ['Left margin', 0],
                  ['Right margin', 2],
                  ['Top margin', 1],
                  ['Bottom margin', 3],
                ] as [string, number][]
              }
            >
              {([label, index]) => (
                <Row label={label}>
                  <NumberField
                    label={label}
                    unit="pt"
                    value={undefined}
                    min={0}
                    max={500}
                    disabled={ro()}
                    onCommit={(v) => {
                      const insets: [number, number, number, number] = [
                        7.2, 3.6, 7.2, 3.6,
                      ];
                      insets[index] = v;
                      void c.body({ insets });
                    }}
                  />
                </Row>
              )}
            </For>
            <label class="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                class="accent-accent"
                disabled={ro()}
                onChange={(e) => void c.body({ wrap: e.currentTarget.checked })}
              />
              Wrap text in shape
            </label>
            <Row label="Columns">
              <NumberField
                label="Columns"
                value={undefined}
                min={1}
                max={16}
                precision={0}
                disabled={ro()}
                onCommit={(columns) => void c.body({ columns })}
              />
            </Row>
          </Section>
          <Section title="Paragraph">
            <Row label="Alignment">
              <Select
                label="Alignment"
                value={c.format().align}
                disabled={ro()}
                options={[
                  ['left', 'Left'],
                  ['center', 'Centered'],
                  ['right', 'Right'],
                  ['justify', 'Justified'],
                  ['distributed', 'Distributed'],
                ]}
                onChange={(a) =>
                  void c.align(a as 'left' | 'center' | 'right' | 'justify')
                }
              />
            </Row>
            <Row label="Before text">
              <NumberField
                label="Indent before text"
                unit="pt"
                value={undefined}
                min={0}
                max={1000}
                disabled={ro()}
                onCommit={(marginLeft) => void c.paragraphs?.({ marginLeft })}
              />
            </Row>
            <Row label="First line">
              <NumberField
                label="First line indent"
                unit="pt"
                value={undefined}
                min={-1000}
                max={1000}
                disabled={ro()}
                onCommit={(indent) => void c.paragraphs?.({ indent })}
              />
            </Row>
            <Row label="Space before">
              <NumberField
                label="Space before"
                unit="pt"
                value={undefined}
                min={0}
                max={1000}
                disabled={ro()}
                onCommit={(v) => void c.spacing(v, undefined)}
              />
            </Row>
            <Row label="Space after">
              <NumberField
                label="Space after"
                unit="pt"
                value={undefined}
                min={0}
                max={1000}
                disabled={ro()}
                onCommit={(v) => void c.spacing(undefined, v)}
              />
            </Row>
            <Row label="Line spacing">
              <NumberField
                label="Line spacing (multiple)"
                unit="×"
                value={undefined}
                min={0.5}
                max={10}
                step={0.1}
                precision={2}
                disabled={ro()}
                onCommit={(v) => void c.lineSpacing(v)}
              />
            </Row>
          </Section>
        </Show>
        <Show when={props.section === 'background'}>
          <Section title="Fill">
            <FillControls
              env={env}
              allowReset
              disabled={ro()}
              apply={(fill) => c.setBackground(fill)}
            />
          </Section>
          <div class="flex gap-2 p-3">
            <Button
              size="sm"
              variant="outline"
              disabled={ro()}
              onClick={() => c.applyBackgroundToAll()}
            >
              Apply to all
            </Button>
          </div>
        </Show>
      </div>
    </aside>
  );
}
