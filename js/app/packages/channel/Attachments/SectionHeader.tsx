import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { Button, cn, Panel } from '@ui';
import { type Accessor, type JSX, Show } from 'solid-js';

export function AttachmentSection(props: {
  contentClass?: string;
  children: JSX.Element;
  action?: JSX.Element;
  class?: string;
  label: string;
  /** Fill the panel height without scrolling, so a child (e.g. a virtualized
   * list) owns the scroll container instead of `Panel.Body`. */
  fillBody?: boolean;
}) {
  return (
    <Panel depth={2} class={cn('h-auto', props.class)}>
      <Panel.Header class="justify-between px-6">
        <h3 class="text-sm font-medium text-ink">{props.label}</h3>
        <div class="shrink-0">{props.action}</div>
      </Panel.Header>
      <Show
        when={props.fillBody}
        fallback={
          <Panel.Body scroll class={props.contentClass}>
            {props.children}
          </Panel.Body>
        }
      >
        <Panel.Body class={cn('flex flex-col', props.contentClass)}>
          {props.children}
        </Panel.Body>
      </Show>
    </Panel>
  );
}

export function LoadMoreButton(props: {
  onLoadMore: () => void;
  isFetching: Accessor<boolean>;
}) {
  return (
    <Button
      variant="base"
      size="sm"
      depth={4}
      class="justify-self-center mt-2 bg-surface"
      onClick={() => props.onLoadMore()}
      disabled={props.isFetching()}
    >
      <Show
        when={!props.isFetching()}
        fallback={
          <>
            <Spinner class="size-3.5 animate-spin" />
            Loading...
          </>
        }
      >
        Load More
      </Show>
    </Button>
  );
}
