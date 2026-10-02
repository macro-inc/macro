import ExpandIcon from '@phosphor/arrows-out-simple.svg';
import GraphIcon from '@phosphor/graph.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { ErrorBoundary, lazy, Show, Suspense } from 'solid-js';
import type { GraphFileSummary } from '../core/graph-changes';
import { graphPath } from '../core/graph-hierarchy';
import type { CodeLocation, ReviewGraph } from '../core/model';

const GraphCanvas = lazy(() => import('./ReviewGraphCanvas'));

export function ReviewGraphPreview(props: {
  graph: ReviewGraph;
  files: GraphFileSummary[];
  activeNode?: string;
  onLocation: (at: CodeLocation, node?: string) => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const active = () =>
    props.graph.nodes.find((node) => node.id === props.activeNode);
  const title = () => active()?.title ?? props.graph.title;
  const path = () =>
    props.activeNode
      ? graphPath(props.graph.nodes, props.activeNode)
          .slice(0, -1)
          .map((node) => node.title)
          .join(' / ')
      : '';
  return (
    <aside
      aria-label="Review map"
      class="absolute bottom-16 right-3 z-10 flex h-56 w-72 max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-lg @min-[900px]/review:bottom-4 @min-[900px]/review:right-4 @min-[900px]/review:h-64 @min-[900px]/review:w-[352px]"
    >
      <header class="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
        <GraphIcon class="size-3.5 shrink-0 text-ink-muted" />
        <span
          class="min-w-0 flex-1 truncate text-xs font-medium"
          title={title()}
        >
          {title()}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Expand map"
          onClick={props.onExpand}
        >
          <ExpandIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Hide map"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </header>
      <Show when={path()}>
        <p
          class="truncate px-3 text-[10px] leading-4 text-ink-muted"
          title={path()}
        >
          {path()}
        </p>
      </Show>
      <Show when={active()?.description}>
        <p class="line-clamp-2 px-3 pt-1 text-[11px] leading-4 text-ink-muted">
          {active()?.description}
        </p>
      </Show>
      <ErrorBoundary
        fallback={
          <Button variant="ghost" size="sm" onClick={props.onExpand}>
            Open overview
          </Button>
        }
      >
        <Suspense fallback={<div class="min-h-0 flex-1" aria-busy="true" />}>
          <GraphCanvas
            graph={props.graph}
            files={props.files}
            activeNode={props.activeNode}
            compact
            onLocation={props.onLocation}
          />
        </Suspense>
      </ErrorBoundary>
    </aside>
  );
}
