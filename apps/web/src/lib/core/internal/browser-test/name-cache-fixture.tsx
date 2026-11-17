import {
  getDisplayName,
  getDisplayNameParts,
  useDisplayName,
} from '@core/user/displayName';
import { emailToMacroId } from '@core/user/macroId';
import { fireAndForget } from '@core/util/fireAndForget';
import { resetQueryAccountSession } from '@queries/auth/account-scope';
import { authKeys } from '@queries/auth/keys';
import { userNameCache } from '@queries/auth/user-name-cache-runtime';
import { useUserNames } from '@queries/auth/user-names';
import { queryClient } from '@queries/client';
import { createSignal, For, Show } from 'solid-js';

export function NameCacheFixture() {
  const [viewer, setViewer] = createSignal('macro|viewer-a@example.com');
  const identity = () => ({ id: viewer(), authenticated: true });
  queryClient.setQueryData(authKeys.userInfo.queryKey, identity());
  const [ids, setIds] = createSignal(['macro|person@example.com']);
  const [visible, setVisible] = createSignal(true);
  const [inspection, inspect] = createSignal(0);
  const participants = useUserNames({
    userIds: () => (visible() ? ids() : []),
  });
  const cache = userNameCache();
  let previous: ReturnType<typeof useDisplayName>[1] | undefined;
  const stats = () => {
    inspection();
    return JSON.stringify(cache.inspect());
  };
  function Label(props: { id: string }) {
    const macroId = () => emailToMacroId(props.id.slice(6));
    const [, controls] = useDisplayName(macroId());
    previous ??= controls;
    return (
      <p data-testid="name-label">
        {getDisplayName(macroId())} · {getDisplayNameParts(macroId()).firstName}
      </p>
    );
  }
  const change = (id: string) => {
    setViewer(id);
    queryClient.setQueryData(authKeys.userInfo.queryKey, identity());
  };
  const relogin = async () => {
    await resetQueryAccountSession();
    await queryClient.fetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      staleTime: 0,
      queryFn: async () => identity(),
    });
  };
  return (
    <main class="p-4 flex flex-col gap-2">
      <output data-testid="name-viewer">{viewer()}</output>
      <Show when={visible()}>
        <For each={ids()}>{(id) => <Label id={id} />}</For>
      </Show>
      <output data-testid="participant-names">
        {participants()
          .map((entry) => entry.name?.first_name ?? 'Unknown')
          .join(', ')}
      </output>
      <button onClick={() => change('macro|viewer-b@example.com')}>
        Account B
      </button>
      <button onClick={() => change('macro|viewer-a@example.com')}>
        Account A
      </button>
      <button onClick={() => fireAndForget(relogin(), 'name-fixture')}>
        Replace session
      </button>
      <button onClick={() => previous?.refetch()}>Refresh captured name</button>
      <button
        onClick={() =>
          previous?.mutate({
            id: 'macro|person@example.com',
            loading: false,
            _createdAt: new Date(),
            firstName: 'Stale override',
          })
        }
      >
        Old override
      </button>
      <button onClick={() => setIds(['macro|other@example.com'])}>
        Recycle label
      </button>
      <button onClick={() => setVisible(false)}>Hide labels</button>
      <button
        onClick={() => {
          for (let index = 0; index < 100_000; index++)
            getDisplayName(emailToMacroId(`browse${index}@example.com`));
          inspect((value) => value + 1);
        }}
      >
        Browse 100k
      </button>
      <button onClick={() => inspect((value) => value + 1)}>
        Inspect cache
      </button>
      <output data-testid="name-cache-stats">{stats()}</output>
    </main>
  );
}
