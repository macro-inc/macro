import { DiffCounts } from '@app/components/diff-view/DiffCounts';
import CaretIcon from '@phosphor/caret-right.svg';
import { Button, cn } from '@ui';
import { For, Show } from 'solid-js';
import type { ComponentChanges } from '../core/graph-changes';
import type { DetailNode } from '../core/graph-detail';
import type { CodeLocation } from '../core/model';
import { ReviewGraphFiles } from './ReviewGraphFiles';

/** Native text over the graph canvas, positioned and zoomed by Cytoscape Layers. */
export function ReviewGraphNode(props: {
  node: DetailNode;
  changes: ComponentChanges;
  zoom: number;
  expanded: boolean;
  visible: boolean;
  browseFiles: boolean;
  onExplore: () => void;
  onFiles: (open: boolean) => void;
  onLocation: (location: CodeLocation) => void;
}) {
  const scale = () => Math.min(props.node.width / 300, 1 / props.zoom);
  const filesOpen = () =>
    props.visible &&
    !props.expanded &&
    (!props.node.children || props.browseFiles) &&
    props.node.width * props.zoom >= 320 &&
    props.node.height * props.zoom >= 180;
  const fileControl = () => (
    <Button
      variant="ghost"
      size="sm"
      tabIndex={-1}
      class="pointer-events-auto -ml-1.5 h-6 gap-1 rounded-md px-1.5 text-[11px]"
      title={filesOpen() ? 'Collapse files' : 'Browse files'}
      on:pointerdown={(event) => event.stopPropagation()}
      on:mousedown={(event) => event.stopPropagation()}
      on:touchstart={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onFiles(!filesOpen());
      }}
    >
      {props.changes.files.length}{' '}
      {props.changes.files.length === 1 ? 'file' : 'files'}
      <CaretIcon class={cn('size-2.5', filesOpen() && 'rotate-90')} />
    </Button>
  );
  const title = () => (
    <p class="min-w-0 flex-1 truncate text-[17px] font-medium leading-5 tracking-tight text-ink">
      {props.node.title}
    </p>
  );
  return (
    <div
      class={cn(
        'absolute flex origin-top-left select-none flex-col overflow-hidden font-sans',
        props.expanded
          ? 'gap-1 px-4 py-3'
          : filesOpen()
            ? 'gap-1.5 px-4 py-3'
            : 'gap-2 px-5 py-4'
      )}
      style={{
        left: `${-props.node.width / 2}px`,
        top: `${-props.node.height / 2}px`,
        width: `${props.node.width / scale()}px`,
        height: props.expanded ? undefined : `${props.node.height / scale()}px`,
        transform: `scale(${scale()})`,
        visibility: props.visible ? 'visible' : 'hidden',
      }}
      data-graph-node={props.node.id}
      data-expanded={props.expanded}
      data-visible={props.visible}
      data-files-open={filesOpen()}
    >
      <div class="flex items-center gap-2 text-[10px] leading-3 text-ink-subtle">
        <Show
          when={filesOpen()}
          fallback={
            <>
              <span class="size-1.5 shrink-0 rounded-full bg-success" />
              <span class="min-w-0 flex-1 truncate tracking-wide">
                {props.node.kind || 'Component'}
              </span>
            </>
          }
        >
          {title()}
        </Show>
        <Show when={props.expanded}>{fileControl()}</Show>
        <Show when={props.node.children}>
          <Button
            variant="ghost"
            size="sm"
            class="pointer-events-auto h-5 shrink-0 gap-1 rounded-md bg-ink/5 px-1.5 text-[10px] tabular-nums hover:bg-ink/10"
            tabIndex={-1}
            title={props.expanded ? 'Collapse details' : 'Explore details'}
            on:pointerdown={(event) => event.stopPropagation()}
            on:mousedown={(event) => event.stopPropagation()}
            on:touchstart={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onExplore();
            }}
          >
            {props.node.children}{' '}
            {props.node.children === 1 ? 'detail' : 'details'}
            <CaretIcon class={cn('size-2.5', props.expanded && 'rotate-90')} />
          </Button>
        </Show>
      </div>
      <Show when={!filesOpen()}>{title()}</Show>
      <Show when={!props.expanded && props.node.description}>
        <p
          class={cn(
            'shrink-0 text-[13px] leading-[18px] text-ink-muted',
            filesOpen() ? 'line-clamp-2' : 'line-clamp-3'
          )}
        >
          {props.node.description}
        </p>
      </Show>
      <Show when={!props.expanded}>
        <div
          class={cn(
            'shrink-0 space-y-1 border-t border-edge-muted/60 pt-2 text-[11px] leading-4 text-ink-subtle',
            !filesOpen() && 'mt-auto'
          )}
        >
          <Show when={!filesOpen()}>
            <div class="space-y-0.5 font-mono text-[10px] text-ink-muted">
              <For each={props.changes.files.slice(0, 2)}>
                {(file) => (
                  <p class="truncate" title={file.path}>
                    {file.path.split('/').slice(-2).join('/')}
                  </p>
                )}
              </For>
            </div>
          </Show>
          <div class="flex items-center justify-between gap-2">
            {fileControl()}
            <DiffCounts
              additions={props.changes.added}
              deletions={props.changes.removed}
            />
          </div>
        </div>
        <Show when={filesOpen()}>
          <ReviewGraphFiles
            files={props.changes.files}
            onLocation={props.onLocation}
          />
        </Show>
      </Show>
    </div>
  );
}
