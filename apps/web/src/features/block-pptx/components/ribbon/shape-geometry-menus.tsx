/**
 * Shape Format ▸ Insert Shapes: Edit Shape (Change Shape, Edit Points) and
 * Merge Shapes (Union, Combine, Fragment, Intersect, Subtract), as in
 * PowerPoint.
 */

import type { MergeMode, ShapeOutline } from '@core/pptx-engine/types';
import PencilSimple from '@phosphor/pencil-simple.svg';
import ShapesIcon from '@phosphor/shapes.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { PopoverItem, PopoverLabel, RibbonPopover } from './controls';
import { useRibbon } from './ribbon';
import { ShapeGallery } from './shape-gallery';

/** What the view does for Edit Points and Merge Shapes. */
export interface ShapeGeometryCommands {
  /** Enters (or leaves) Edit Points for the one selected shape. */
  toggleEditPoints: () => void;
  /** Whether Edit Points is on. */
  editingPoints: () => boolean;
  /** Merges the selected shapes, the first selected one's look winning. */
  merge: (mode: MergeMode) => void;
}

/** Shapes whose outline can be edited. */
export const pointsEditable = (s: ShapeOutline) =>
  s.kind === 'shape' || s.kind === 'text';

/** Shapes Merge Shapes takes: drawn shapes, text boxes, and pictures. */
export const mergeable = (s: ShapeOutline) =>
  s.kind === 'shape' || s.kind === 'text' || s.kind === 'picture';

/** Two overlapping circles, drawn as each merge leaves them. */
function MergeIcon(props: { mode: MergeMode }) {
  const lens = 'M8 3.97A4.5 4.5 0 0 1 8 12.03A4.5 4.5 0 0 1 8 3.97Z';
  const left = 'M6 3.5A4.5 4.5 0 1 0 6 12.5A4.5 4.5 0 1 0 6 3.5Z';
  const right = 'M10 3.5A4.5 4.5 0 1 0 10 12.5A4.5 4.5 0 1 0 10 3.5Z';
  const minus = 'M8 3.97A4.5 4.5 0 1 0 8 12.03A4.5 4.5 0 0 1 8 3.97Z';
  const outline = (d: string) => (
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      stroke-width="0.8"
      stroke-dasharray="1.2 1"
    />
  );
  const shapes: Record<MergeMode, JSX.Element> = {
    union: <path d={`${left}${right}`} fill="currentColor" />,
    combine: (
      <path d={`${left}${right}`} fill="currentColor" fill-rule="evenodd" />
    ),
    fragment: (
      <>
        <path
          d={`${left}${right}`}
          fill="currentColor"
          fill-opacity="0.45"
          fill-rule="evenodd"
          stroke="currentColor"
          stroke-width="0.8"
        />
        <path
          d={lens}
          fill="currentColor"
          stroke="currentColor"
          stroke-width="0.8"
        />
      </>
    ),
    intersect: (
      <>
        {outline(left)}
        {outline(right)}
        <path d={lens} fill="currentColor" />
      </>
    ),
    subtract: (
      <>
        {outline(right)}
        <path d={minus} fill="currentColor" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 16 16" class="size-4 text-accent" aria-hidden="true">
      {shapes[props.mode]}
    </svg>
  );
}

const MERGES: { mode: MergeMode; label: string }[] = [
  { mode: 'union', label: 'Union' },
  { mode: 'combine', label: 'Combine' },
  { mode: 'fragment', label: 'Fragment' },
  { mode: 'intersect', label: 'Intersect' },
  { mode: 'subtract', label: 'Subtract' },
];

/** Edit Shape: Change Shape (the preset gallery) and Edit Points. */
export function EditShapeMenu() {
  const env = useRibbon();
  const geometry = () => env.shapeGeometry;
  const one = () =>
    env.selection().length === 1 ? env.selection()[0] : undefined;
  const canChange = () =>
    !env.readonly() && env.selection().some((s) => pointsEditable(s));
  const canEditPoints = () => {
    const s = one();
    return !env.readonly() && !!geometry() && !!s && pointsEditable(s);
  };
  return (
    <RibbonPopover
      label="Edit Shape"
      text="Edit Shape"
      icon={<PencilSimple class="size-3.5" />}
      disabled={!canChange()}
      testId="pptx-edit-shape"
    >
      {(close) => {
        // Change Shape opens the gallery in place of the menu.
        const [gallery, setGallery] = createSignal(false);
        return (
          <Show
            when={gallery()}
            fallback={
              <div class="flex w-48 flex-col">
                <PopoverItem
                  label="Change Shape"
                  icon={<ShapesIcon />}
                  hint="▸"
                  testId="pptx-change-shape"
                  onClick={() => setGallery(true)}
                />
                <PopoverItem
                  label="Edit Points"
                  icon={<PencilSimple />}
                  active={geometry()?.editingPoints()}
                  disabled={!canEditPoints()}
                  testId="pptx-edit-points"
                  onClick={() => {
                    close();
                    geometry()?.toggleEditPoints();
                  }}
                />
              </div>
            }
          >
            <ShapeGallery
              load={env.presetPaths}
              categories={[
                'Rectangles',
                'Basic shapes',
                'Block arrows',
                'Flowchart',
                'Stars and banners',
                'Callouts',
              ]}
              onPick={(preset) => {
                close();
                void env.commands.setGeometry(preset);
              }}
            />
          </Show>
        );
      }}
    </RibbonPopover>
  );
}

/** Merge Shapes: enabled with two or more shapes selected. */
export function MergeShapesMenu() {
  const env = useRibbon();
  const enabled = () => {
    const list = env.selection();
    return (
      !env.readonly() &&
      !!env.shapeGeometry &&
      list.length >= 2 &&
      list.every(mergeable)
    );
  };
  return (
    <RibbonPopover
      label="Merge Shapes"
      text="Merge Shapes"
      icon={<MergeIcon mode="union" />}
      disabled={!enabled()}
      testId="pptx-merge-shapes"
    >
      {(close) => (
        <div class="flex w-44 flex-col">
          <PopoverLabel>Merge Shapes</PopoverLabel>
          <For each={MERGES}>
            {(m) => (
              <PopoverItem
                label={m.label}
                icon={<MergeIcon mode={m.mode} />}
                testId={`pptx-merge-${m.mode}`}
                onClick={() => {
                  close();
                  env.shapeGeometry?.merge(m.mode);
                }}
              />
            )}
          </For>
        </div>
      )}
    </RibbonPopover>
  );
}
