import type { PaneId, PaneLayout, SplitPath } from '@app/lib/split-router';
import { Gutter } from '@core/component/Resize';
import { moveHandleShares } from '@core/component/Resize/solver';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
} from 'solid-js';
import {
  type Rect,
  type SolvedSplit,
  solveTiles,
  type TileArea,
  type TileGeometry,
} from './split-geometry';

type TiledSplitsProps = {
  layout: Accessor<PaneLayout | undefined>;
  /** The panes to render, in order; the layout's panes once it catches up. */
  panes: Accessor<readonly PaneId[]>;
  gutter: number;
  showDividers: boolean;
  onResize: (path: SplitPath, shares: readonly number[]) => void;
  /** Reports the measured area, for deciding whether another split fits. */
  onArea: (area: TileArea) => void;
  children: (pane: PaneId, index: Accessor<number>) => JSX.Element;
};

const rectStyle = (rect: Rect): JSX.CSSProperties => ({
  position: 'absolute',
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
});

const sameArea = (left: TileArea, right: TileArea) =>
  left.width === right.width &&
  left.height === right.height &&
  left.gutter === right.gutter;

/**
 * Lays the panes out as the layout tree tiles them. Every pane stays in one
 * keyed list and is positioned absolutely, so splitting or closing a
 * neighbour never moves a pane's content to another parent and remounts it.
 */
export function TiledSplits(props: TiledSplitsProps) {
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const size = createElementSize(root);
  const area = createMemo(
    (): TileArea => ({
      width: size.width ?? 0,
      height: size.height ?? 0,
      gutter: props.gutter,
    }),
    undefined,
    { equals: sameArea }
  );

  createEffect(() => props.onArea(area()));

  const geometry = createMemo<TileGeometry | undefined>((previous) => {
    const current = area();
    // Unmeasured or hidden: keep the last real layout instead of collapsing every split.
    const unmeasured = current.width <= 0 || current.height <= 0;
    if (previous && unmeasured) return previous;

    return solveTiles(props.layout(), current);
  });

  const gutters = createMemo(() =>
    (geometry()?.splits ?? []).flatMap((split) =>
      split.gutters.map((offset, index) => ({ split, index, offset }))
    )
  );

  const nudge = (split: SolvedSplit, index: number, deltaPx: number) => {
    const length = split.axis === 'row' ? split.rect.width : split.rect.height;
    const shares = moveHandleShares({
      panels: split.minimums.map((minSize) => ({
        minSize,
        maxSize: Infinity,
      })),
      shares: split.shares,
      index,
      deltaPx,
      usable: length - props.gutter * (split.shares.length - 1),
    });
    if (shares) props.onResize(split.path, shares);
  };

  return (
    <div
      ref={setRoot}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      data-resize-zone
    >
      <For each={props.panes()}>
        {(pane, index) => {
          const style = (): JSX.CSSProperties => {
            const rect = geometry()?.panes.get(pane);

            return rect ? rectStyle(rect) : { display: 'none' };
          };

          return (
            <div style={style()} data-resize-panel data-split-pane={pane}>
              {props.children(pane, index)}
            </div>
          );
        }}
      </For>
      {/* Index keeps each gutter mounted while a drag re-solves the layout every frame. */}
      <Index each={gutters()}>
        {(gutter) => {
          const [box, setBox] = createSignal<HTMLDivElement>();
          const horizontal = () => gutter().split.axis === 'row';

          return (
            <div
              ref={setBox}
              style={{
                ...rectStyle(gutter().split.rect),
                'pointer-events': 'none',
              }}
            >
              <Gutter
                direction={horizontal() ? 'horizontal' : 'vertical'}
                gutterSize={props.gutter}
                showDivider={props.showDividers}
                offset={gutter().offset}
                index={gutter().index}
                resizable
                nudge={(index, deltaPx) =>
                  nudge(gutter().split, index, deltaPx)
                }
                onChangeStart={() => {}}
                onChangeEnd={() => {}}
                root={box}
              />
            </div>
          );
        }}
      </Index>
    </div>
  );
}
