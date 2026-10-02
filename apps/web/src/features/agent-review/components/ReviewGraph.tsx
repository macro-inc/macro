import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { Button } from '@ui';
import {
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  lazy,
  Show,
  Suspense,
} from 'solid-js';
import {
  type GraphFile,
  type GraphFileSummary,
  graphChanges,
} from '../core/graph-changes';
import { graphPath } from '../core/graph-hierarchy';
import type { CodeLocation, ReviewGraph as Graph } from '../core/model';
import { ReviewGraphFiles } from './ReviewGraphFiles';

const GraphCanvas = lazy(() => import('./ReviewGraphCanvas'));

export function ReviewGraph(props: {
  graph: Graph;
  files: GraphFileSummary[];
  count: number;
  activeNode?: string;
  nextChapter?: string;
  onNext: () => void;
  onLocation: (at: CodeLocation, node?: string) => void;
}) {
  const changes = createMemo(() => graphChanges(props.graph, props.files));
  const links = (): MapLink[] => [
    ...props.graph.nodes.map((node) => {
      const counts = changes().get(node.id)!;
      return {
        label: graphPath(props.graph.nodes, node.id)
          .map((node) => node.title)
          .join(' / '),
        location: node.location,
        node: node.id,
        files: counts.files,
        summary: [
          node.kind,
          node.description,
          `${counts.files.length} changed ${counts.files.length === 1 ? 'file' : 'files'} · ${counts.added} added · ${counts.removed} removed`,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }),
    ...props.graph.edges.flatMap((edge) =>
      edge.location
        ? [
            {
              label: edge.label,
              location: edge.location,
              node: undefined,
              summary: undefined,
            },
          ]
        : []
    ),
  ];
  const codeLinks = () => (
    <For each={links()}>
      {(link) => <ReviewMapLink link={link} onLocation={props.onLocation} />}
    </For>
  );
  return (
    <section
      class="flex min-h-0 flex-1 flex-col gap-5 p-4 @min-[1000px]/review:gap-5 @min-[1000px]/review:p-6"
      aria-label="Component map"
    >
      <header class="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <p class="mb-2 text-xs text-ink-muted">
            Walkthrough <span class="px-1.5 text-ink-extra-muted">/</span>{' '}
            <span class="tabular-nums">1 of {props.count}</span>
          </p>
          <h2 class="text-xl font-medium tracking-tight @min-[1000px]/review:text-2xl">
            {props.graph.title || 'Overview'}
          </h2>
        </div>
        <Show when={props.nextChapter}>
          <Button
            size="sm"
            variant="outline"
            class="max-w-full rounded-xl"
            aria-label="Next chapter"
            onClick={props.onNext}
          >
            <span class="truncate">{props.nextChapter}</span>
            <ArrowRightIcon />
          </Button>
        </Show>
      </header>
      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-edge-muted bg-panel">
        <ErrorBoundary
          fallback={
            <div class="flex flex-col overflow-y-auto p-4">{codeLinks()}</div>
          }
        >
          <Suspense fallback={<div class="min-h-0 flex-1" aria-busy="true" />}>
            <GraphCanvas
              graph={props.graph}
              files={props.files}
              activeNode={props.activeNode}
              onLocation={props.onLocation}
            />
          </Suspense>
          <div
            class="sr-only focus-within:not-sr-only focus-within:absolute focus-within:inset-x-3 focus-within:bottom-3 focus-within:z-10 focus-within:flex focus-within:max-h-48 focus-within:flex-col focus-within:overflow-auto focus-within:rounded-xl focus-within:border focus-within:border-edge-muted focus-within:bg-panel focus-within:p-2 focus-within:shadow-lg"
            aria-label="Map code links"
          >
            {codeLinks()}
          </div>
        </ErrorBoundary>
      </div>
    </section>
  );
}

type MapLink = {
  label: string;
  location: CodeLocation;
  node?: string;
  summary?: string;
  files?: GraphFile[];
};

function ReviewMapLink(props: {
  link: MapLink;
  onLocation: (location: CodeLocation, node?: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="shrink-0">
      <button
        type="button"
        class="w-full rounded-lg px-3 py-2 text-left text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
        onClick={() => props.onLocation(props.link.location, props.link.node)}
      >
        <span class="font-medium text-ink">{props.link.label}</span>
        <Show when={props.link.summary}>
          <span class="mt-1 block">{props.link.summary}</span>
        </Show>
        <span class="mt-1 block truncate font-mono">
          {props.link.location.path}:{props.link.location.line}
        </span>
      </button>
      <Show when={(props.link.files?.length ?? 0) > 1}>
        <details
          class="px-3 pb-2 text-xs text-ink-muted"
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary class="rounded outline-none focus-visible:ring-2 focus-visible:ring-edge-focus">
            Files in {props.link.label} ({props.link.files!.length})
          </summary>
          <Show when={open()}>
            <div class="mt-2 flex h-56 flex-col">
              <ReviewGraphFiles
                files={props.link.files!}
                keyboard
                onLocation={(location) =>
                  props.onLocation(location, props.link.node)
                }
              />
            </div>
          </Show>
        </details>
      </Show>
    </div>
  );
}
