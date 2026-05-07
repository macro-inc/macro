import { type Accessor, Show, type JSX } from 'solid-js';
import { Button } from '@ui';
import { Panel } from '@ui';
import { cn } from '@ui';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';

export function AttachmentSection(props: {
  contentClass?: string;
  children: JSX.Element;
  action?: JSX.Element;
  class?: string;
  label: string;
}) {
  return (
    <Panel depth={2} class={cn('h-auto', props.class)}>
      <Panel.Header class="justify-between">
        <h3 class="text-sm font-medium text-ink">{props.label}</h3>
        <div class="shrink-0">{props.action}</div>
      </Panel.Header>
      <Panel.Body class={cn('px-3 py-3', props.contentClass)}>
        {props.children}
      </Panel.Body>
    </Panel>
  );
}

export function LoadMoreButton(props: {
  onLoadMore: () => void;
  isFetching: Accessor<boolean>;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      class="w-full"
      onClick={() => props.onLoadMore()}
      disabled={props.isFetching()}
    >
      <Show
        when={!props.isFetching()}
        fallback={
          <>
            <Spinner class="w-3.5 h-3.5 animate-spin" />
            Loading...
          </>
        }
      >
        Load more
      </Show>
    </Button>
  );
}
