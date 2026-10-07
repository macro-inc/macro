import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { granolaSyncClient } from '@service-cognition/granola-sync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, Show, Suspense } from 'solid-js';
import { GranolaSyncCard } from './components/GranolaSyncCard';
import type { GranolaScope } from './core/types';

/** Settings owns the production adapters; the card only receives display props. */
export function GranolaSyncSettings(props: { connected: boolean }) {
  return (
    <Suspense>
      <GranolaSyncSettingsContent connected={props.connected} />
    </Suspense>
  );
}

function GranolaSyncSettingsContent(props: { connected: boolean }) {
  const user = useUserId();
  const cache = useQueryClient();
  const [scope, setScope] = createSignal<GranolaScope>('personal');
  const [selected, setSelected] = createSignal<string>();
  const key = () => ['granolaSync', user()] as const;
  const status = useQuery(() => ({
    queryKey: [...key(), 'status'],
    enabled: !!user(),
    queryFn: () => throwOnErr(granolaSyncClient.status),
    refetchInterval: 15_000,
  }));
  const meetings = useQuery(() => ({
    queryKey: [...key(), 'meetings'],
    enabled: !!user(),
    queryFn: () => throwOnErr(granolaSyncClient.meetings),
    refetchInterval: 30_000,
  }));
  const meeting = useQuery(() => ({
    queryKey: [...key(), 'meeting', selected()],
    enabled: !!user() && !!selected(),
    queryFn: () => {
      const id = selected();
      if (!id) throw new Error('Select a meeting');
      return throwOnErr(() => granolaSyncClient.meeting(id));
    },
    refetchInterval: 30_000,
  }));
  const change = useMutation(() => ({
    mutationFn: (start: boolean) =>
      throwOnErr(() =>
        start ? granolaSyncClient.start(scope()) : granolaSyncClient.stop()
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: key() });
    },
  }));
  return (
    <Show
      when={props.connected || (meetings.isSuccess && meetings.data.length > 0)}
    >
      <GranolaSyncCard
        status={status.isSuccess ? status.data : undefined}
        meetings={meetings.isSuccess ? meetings.data : []}
        record={meeting.isSuccess ? meeting.data : undefined}
        pending={change.isPending}
        error={
          change.isError
            ? 'Could not change sync. Check your Granola key and selected access, then retry.'
            : status.isError || meetings.isError || meeting.isError
              ? 'Could not load Granola sync. Try again shortly.'
              : undefined
        }
        scope={scope()}
        onScope={setScope}
        onStart={() => change.mutate(true)}
        onStop={() => change.mutate(false)}
        onSelect={setSelected}
      />
    </Show>
  );
}
