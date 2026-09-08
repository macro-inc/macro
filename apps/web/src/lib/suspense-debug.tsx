import { queryClient } from '@queries/client';
import { onCleanup, onMount } from 'solid-js';

export function SuspenseDebug(props: { label: string }) {
  onMount(() => {
    console.info('[suspense-debug] fallback', props.label, performance.now(), JSON.stringify(queryClient.getQueryCache().getAll().filter(q => q.state.fetchStatus === 'fetching').map(q=>({key:q.queryKey.slice(0,3), status:q.state.status}))));
    onCleanup(() => console.info('[suspense-debug] resolved', props.label, performance.now()));
  });
  return <span data-suspense-debug={props.label} class="sr-only">Loading {props.label}</span>;
}
