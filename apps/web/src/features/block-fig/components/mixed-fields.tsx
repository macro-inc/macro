/**
 * The design panel for several selected layers: what they share shows its
 * value, what differs shows "Mixed", and typing sets it on all of them, as
 * in Figma. Mixed fills or strokes are replaced with "+". Presentational.
 */

import type { PaintInfo } from '@core/fig-engine/types';
import { type JSX, Show } from 'solid-js';
import { formatMeasure } from '../core/measure';
import { MIXED, type Mixed, type MixedInfo } from '../core/mixed';
import type { PaintEdit } from '../core/paint';
import type { Patch } from '../primitives/create-fig-editor';
import { NumberField } from './design-fields';
import { PaintList } from './paint-controls';
import { Section } from './panel-section';

const value = (v: Mixed<number>) => (v === MIXED ? 0 : v);

function MixedRow(props: { children: JSX.Element }) {
  return (
    <div class="rounded-md bg-inset px-2 py-1 text-ink-muted">
      {props.children}
    </div>
  );
}

/** Fills or strokes shared by all the layers, or "Mixed". */
function MixedPaints(props: {
  title: string;
  kind: 'fill' | 'stroke';
  paints: Mixed<PaintInfo[]>;
  swatches?: readonly string[];
  onPickerOpen?: () => void;
  onAddImage?: (file: File) => Promise<string | undefined>;
  onPatch: (patch: Patch, live: boolean) => void;
}) {
  const patch = (specs: PaintEdit[]): Patch =>
    props.kind === 'fill' ? { fills: specs } : { strokes: specs };
  const added = () =>
    props.kind === 'fill' ? { color: 'D9D9D9' } : { color: '000000' };
  return (
    <Section
      title={props.title}
      testId={`fig-${props.kind}s`}
      onAdd={() => {
        const paints = props.paints;
        // "+" replaces mixed paints with one; otherwise it adds one on top.
        const kept =
          paints === MIXED ? [] : paints.map((_, keep) => ({ keep }));
        props.onPatch(patch([...kept, added()]), false);
      }}
    >
      <Show
        when={props.paints !== MIXED && props.paints}
        fallback={<MixedRow>Mixed · click + to replace</MixedRow>}
      >
        {(paints) => (
          <PaintList
            paints={paints()}
            kind={props.kind}
            swatches={props.swatches}
            onPickerOpen={props.onPickerOpen}
            onAddImage={props.onAddImage}
            onChange={(specs, live) => props.onPatch(patch(specs), live)}
          />
        )}
      </Show>
    </Section>
  );
}

export function MixedFields(props: {
  mixed: MixedInfo;
  /** Edits all the selected layers; absent when read-only. */
  onPatch?: (patch: Patch, live: boolean) => void;
  swatches?: readonly string[];
  onPickerOpen?: () => void;
  onAddImage?: (file: File) => Promise<string | undefined>;
}) {
  const m = () => props.mixed;
  const shown = (v: Mixed<number> | undefined) =>
    v === MIXED ? 'Mixed' : v === undefined ? '' : formatMeasure(v);
  return (
    <div data-testid="fig-mixed">
      <div class="border-edge-muted border-b px-3 py-3">
        <div class="font-semibold text-sm">{m().count} layers selected</div>
      </div>
      <Show
        when={props.onPatch}
        fallback={
          <Section title="Layout">
            <div class="grid grid-cols-2 gap-1.5 text-ink-muted">
              <span>X {shown(m().x)}</span>
              <span>Y {shown(m().y)}</span>
              <span>W {shown(m().width)}</span>
              <span>H {shown(m().height)}</span>
            </div>
          </Section>
        }
      >
        {(patch) => (
          <>
            <Show when={!m().inInstance}>
              <Section title="Layout">
                <div class="grid grid-cols-2 gap-1.5">
                  <NumberField
                    label="X"
                    value={value(m().x)}
                    mixed={m().x === MIXED}
                    testId="fig-field-x"
                    onChange={(x, live) => patch()({ x }, live)}
                  />
                  <NumberField
                    label="Y"
                    value={value(m().y)}
                    mixed={m().y === MIXED}
                    testId="fig-field-y"
                    onChange={(y, live) => patch()({ y }, live)}
                  />
                  <NumberField
                    label="W"
                    value={value(m().width)}
                    mixed={m().width === MIXED}
                    min={0.01}
                    testId="fig-field-w"
                    onChange={(width, live) => patch()({ width }, live)}
                  />
                  <NumberField
                    label="H"
                    value={value(m().height)}
                    mixed={m().height === MIXED}
                    min={0.01}
                    testId="fig-field-h"
                    onChange={(height, live) => patch()({ height }, live)}
                  />
                  <NumberField
                    label="↻"
                    value={value(m().rotation)}
                    mixed={m().rotation === MIXED}
                    testId="fig-field-rotation"
                    onChange={(rotation, live) => patch()({ rotation }, live)}
                  />
                  <Show when={m().radius !== undefined}>
                    <NumberField
                      label="◜"
                      value={value(m().radius ?? 0)}
                      mixed={m().radius === MIXED}
                      min={0}
                      testId="fig-field-radius"
                      onChange={(cornerRadius, live) =>
                        patch()({ cornerRadius }, live)
                      }
                    />
                  </Show>
                </div>
              </Section>
            </Show>
            <Section title="Appearance">
              <div class="grid grid-cols-2 gap-1.5">
                <NumberField
                  label="◐"
                  value={value(m().opacity)}
                  mixed={m().opacity === MIXED}
                  percent
                  min={0}
                  max={1}
                  testId="fig-field-opacity"
                  onChange={(opacity, live) => patch()({ opacity }, live)}
                />
              </div>
            </Section>
            <MixedPaints
              title="Fill"
              kind="fill"
              paints={m().fills}
              swatches={props.swatches}
              onPickerOpen={props.onPickerOpen}
              onAddImage={props.onAddImage}
              onPatch={patch()}
            />
            <MixedPaints
              title="Stroke"
              kind="stroke"
              paints={m().strokes}
              swatches={props.swatches}
              onPickerOpen={props.onPickerOpen}
              onAddImage={props.onAddImage}
              onPatch={patch()}
            />
            <Show when={m().strokeWeight !== undefined}>
              <div class="-mt-2 grid grid-cols-2 gap-1.5 border-edge-muted border-b px-3 pb-3">
                <NumberField
                  label="≡"
                  value={value(m().strokeWeight ?? 0)}
                  mixed={m().strokeWeight === MIXED}
                  min={0}
                  testId="fig-field-stroke-weight"
                  onChange={(strokeWeight, live) =>
                    patch()({ strokeWeight }, live)
                  }
                />
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
