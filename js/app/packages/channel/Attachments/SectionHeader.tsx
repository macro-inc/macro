import { type Accessor, Show, type JSX } from 'solid-js';
import { Button } from '@ui/components/Button';
import { Window } from '@ui/components/Window';
import { cn } from '@ui/utils/classname';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';

export function AttachmentSection(props: {
  label: string;
  action?: JSX.Element;
  children: JSX.Element;
  class?: string;
  contentClass?: string;
}) {
  return (
    <Window depth={2} class={cn('h-auto', props.class)}>
      <Window.Header class="justify-between">
        <h3 class="text-sm font-medium text-ink">{props.label}</h3>
        <div class="shrink-0">{props.action}</div>
      </Window.Header>
      <Window.Body class={cn('px-3 py-3', props.contentClass)}>
        {props.children}
      </Window.Body>
    </Window>
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
