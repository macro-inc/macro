import { type Accessor, Show, type JSX } from 'solid-js';
import { Button } from '@ui/components/Button';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';

export function SectionHeader(props: { label: string; action?: JSX.Element }) {
  return (
    <>
      <div class="flex items-center justify-between px-2 py-1.5">
        <h3 class="text-xs font-medium text-ink-muted/70">{props.label}</h3>
        {props.action}
      </div>
      <div class="border-b border-edge-muted/50" />
    </>
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
