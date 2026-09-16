import { SidePanel } from '@components/app/side-panel';
import ListIcon from '@phosphor/list-bullets.svg';
import { useCrmLists } from '@queries/crm/lists';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';

export function CompanyListsSection(props: { companyId: string }) {
  const team = useCurrentTeamQuery();
  const teamId = () => (team.isSuccess ? team.data?.team.id : undefined);
  const lists = useCrmLists(teamId);
  const [editing, setEditing] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [error, setError] = createSignal('');
  const memberships = () =>
    lists
      .lists()
      .filter((list) => list.config.companyIds.includes(props.companyId));
  const filtered = () =>
    lists
      .lists()
      .filter((list) =>
        list.name.toLowerCase().includes(search().trim().toLowerCase())
      );
  async function setMembership(listId: string, included: boolean) {
    if (lists.setMembership.isPending) return;
    setError('');
    try {
      await lists.setMembership.mutateAsync({
        listId,
        companyId: props.companyId,
        included,
      });
    } catch {
      setError('Could not update list membership. Please try again.');
    }
  }
  return (
    <SidePanel.Section id="company-lists" title="Lists" order={18} defaultOpen>
      <div class="flex flex-col gap-3">
        <Show when={team.isError || lists.query.isError}>
          <div
            role="alert"
            class="flex items-center justify-between gap-2 text-xs text-ink-muted"
          >
            <span>Could not load lists.</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                void team.refetch();
                void lists.query.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        </Show>
        <Show when={team.isLoading || (!!teamId() && lists.query.isLoading)}>
          <p class="text-xs text-ink-muted">Loading lists…</p>
        </Show>
        <Show when={lists.query.isSuccess && teamId()}>
          <Show
            when={memberships().length}
            fallback={
              <p class="text-xs text-ink-muted">Not in any lists yet.</p>
            }
          >
            <div
              class="flex flex-wrap gap-1.5"
              aria-label="Company list memberships"
            >
              <For each={memberships()}>
                {(list) => (
                  <span
                    class="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-active px-2 py-1 text-xs"
                    title={list.name}
                  >
                    <ListIcon class="size-3.5 shrink-0" />
                    <span class="truncate">{list.name}</span>
                  </span>
                )}
              </For>
            </div>
          </Show>
          <Button
            variant="ghost"
            size="sm"
            class="self-start"
            aria-expanded={editing()}
            onClick={() => setEditing(!editing())}
          >
            {editing() ? 'Done' : 'Manage lists'}
          </Button>
          <Show when={editing()}>
            <p class="text-xs text-ink-muted">
              Your personal company lists. Changes save immediately.
            </p>
            <Show
              when={lists.lists().length}
              fallback={
                <p class="text-xs text-ink-muted">
                  Create a list in the CRM sidebar to get started.
                </p>
              }
            >
              <input
                aria-label="Find company lists"
                placeholder="Find a list…"
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
                class="w-full rounded-lg border border-edge-muted bg-input px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
              <div
                class="max-h-56 overflow-y-auto"
                aria-busy={lists.setMembership.isPending}
              >
                <For each={filtered()}>
                  {(list) => (
                    <label class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-hover">
                      <input
                        type="checkbox"
                        checked={list.config.companyIds.includes(
                          props.companyId
                        )}
                        disabled={lists.setMembership.isPending}
                        onChange={(event) => {
                          const included = event.currentTarget.checked;
                          event.currentTarget.checked =
                            list.config.companyIds.includes(props.companyId);
                          void setMembership(list.id, included);
                        }}
                      />
                      <span class="min-w-0 truncate" title={list.name}>
                        {list.name}
                      </span>
                    </label>
                  )}
                </For>
                <Show when={!filtered().length}>
                  <p class="px-2 py-2 text-xs text-ink-muted">
                    No matching lists.
                  </p>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
        <Show when={lists.setMembership.isPending}>
          <p role="status" class="text-xs text-ink-muted">
            Saving…
          </p>
        </Show>
        <Show when={error()}>
          <p role="alert" class="text-xs text-failure">
            {error()}
          </p>
        </Show>
        <Show when={team.isSuccess && !teamId()}>
          <p class="text-xs text-ink-muted">
            Join a team to use company lists.
          </p>
        </Show>
      </div>
    </SidePanel.Section>
  );
}
