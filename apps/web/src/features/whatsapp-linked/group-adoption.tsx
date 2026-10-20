import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import WhatsAppIcon from '@phosphor/whatsapp-logo.svg';
import XIcon from '@phosphor/x.svg';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { useLinkedActions, useLinkedGroups } from '@queries/whatsapp-linked';
import { Button, Checkbox, Dialog, InputGroup, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';

export function ConnectWhatsAppGroup(props: { onSelect: () => void }) {
  const flag = useFeatureFlag(enableWhatsappLinked);
  return (
    <Show when={flag().enabled}>
      <Panel.Footer class="px-4 py-2 sm:px-6">
        <Button
          variant="ghost"
          fullWidth
          class="h-auto min-h-14 w-full justify-start gap-3 rounded-lg px-2 py-3 text-left"
          label="Connect WhatsApp group"
          tooltipDisabled
          onClick={props.onSelect}
        >
          <WhatsAppIcon class="size-5" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-ink">Connect WhatsApp group</span>
            <span class="block text-xs font-normal text-ink-muted">
              Bring an existing group into Macro
            </span>
          </span>
          <CaretRightIcon class="size-4" />
        </Button>
      </Panel.Footer>
    </Show>
  );
}

/** Content of the channel dialog, so choosing a group never stacks another modal. */
export function WhatsAppGroupPicker(props: {
  searchRef: (input: HTMLInputElement) => void;
  onBack: () => void;
  onConnectingChange: (connecting: boolean) => void;
  onConnected: (channel: string) => void;
}) {
  const user = useUserId();
  const team = useCurrentTeamQuery();
  const groups = useLinkedGroups(
    () => user() ?? '',
    () => true
  );
  const actions = useLinkedActions();
  const [search, setSearch] = createSignal('');
  const [selected, setSelected] = createSignal('');
  const [error, setError] = createSignal('');
  const [audience, setAudience] = createSignal<string[]>([]);
  const currentTeam = () =>
    queryReadyGate(team) ? team.data?.team : undefined;
  const visibleGroups = () =>
    queryReadyGate(groups)
      ? (groups.data ?? []).filter((group) =>
          group.name
            .toLocaleLowerCase()
            .includes(search().trim().toLocaleLowerCase())
        )
      : [];

  async function adopt() {
    const target = currentTeam();
    if (!target || !user() || !selected() || actions.adopt.isPending) return;
    setError('');
    props.onConnectingChange(true);
    try {
      const result = await actions.adopt.mutateAsync({
        team_id: target.id,
        group_jid: selected(),
        users: [user()!, ...audience()],
      });
      props.onConnected(result.channel_id);
    } catch {
      setError(
        'This group could not be connected. Check your WhatsApp membership and Macro access, then try again.'
      );
    } finally {
      props.onConnectingChange(false);
    }
  }

  return (
    <>
      <Panel.Header class="justify-between border-0 px-6 pt-6 pb-4 sm:px-8">
        <div class="min-w-0">
          <Dialog.Title class="text-xl font-semibold text-ink">
            Connect WhatsApp group
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-ink-muted">
            Choose a group for {currentTeam()?.name ?? 'this workspace'}.
          </Dialog.Description>
        </div>
        <Dialog.CloseButton
          as={Button}
          variant="ghost"
          size="icon-sm"
          label="Close"
          tabIndex={-1}
          disabled={actions.adopt.isPending}
        >
          <XIcon />
        </Dialog.CloseButton>
      </Panel.Header>
      <Panel.Toolbar class="border-0 px-6 pb-3 sm:px-8">
        <InputGroup class="w-full">
          <InputGroup.Addon>
            <MagnifyingGlassIcon class="size-4" />
          </InputGroup.Addon>
          <InputGroup.Input
            ref={props.searchRef}
            aria-label="Search WhatsApp groups"
            placeholder="Search groups"
            value={search()}
            onInput={(event) => {
              setSearch(event.currentTarget.value);
              setSelected('');
              setAudience([]);
              setError('');
            }}
          />
        </InputGroup>
      </Panel.Toolbar>
      <Panel.Body scroll class="px-6 pb-5 sm:px-8">
        <div class="flex flex-col gap-5">
          <div
            class="flex min-h-32 flex-col gap-1"
            aria-label="WhatsApp groups"
          >
            <Show
              when={queryReadyGate(groups)}
              fallback={
                <p role="status" class="py-6 text-sm text-ink-muted">
                  {groups.isError
                    ? 'Could not load your groups.'
                    : 'Loading groups…'}
                </p>
              }
            >
              <For
                each={visibleGroups()}
                fallback={
                  <p role="status" class="py-6 text-sm text-ink-muted">
                    {search().trim()
                      ? 'No groups match your search.'
                      : 'No WhatsApp groups found.'}
                  </p>
                }
              >
                {(group) => (
                  <Button
                    variant="ghost"
                    class="h-auto min-h-14 justify-start gap-3 rounded-lg px-3 py-2 text-left"
                    fullWidth
                    tooltip={group.name}
                    aria-pressed={selected() === group.jid}
                    disabled={actions.adopt.isPending}
                    onClick={() => {
                      setSelected(group.jid);
                      setAudience([]);
                      setError('');
                    }}
                  >
                    <WhatsAppIcon class="size-5 text-ink-muted" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm text-ink">
                        {group.name}
                      </span>
                      <span class="block text-xs font-normal text-ink-muted">
                        {group.participants.length} members
                      </span>
                    </span>
                    <Show when={selected() === group.jid}>
                      <CheckIcon class="size-4 text-ink" />
                    </Show>
                  </Button>
                )}
              </For>
            </Show>
          </div>
          <Show when={selected()}>
            <fieldset class="flex flex-col gap-2 border-t border-edge-divider pt-4">
              <legend class="float-left w-full text-sm font-medium text-ink">
                Macro access
              </legend>
              <p class="text-xs text-ink-muted">
                Add teammates who belong to this group. Each connects their own
                WhatsApp account.
              </p>
              <For
                each={
                  queryReadyGate(team)
                    ? (team.data?.members.filter(
                        (member) => member.user_id !== user()
                      ) ?? [])
                    : []
                }
              >
                {(member) => (
                  <Checkbox
                    class="min-h-9 touch:min-h-11"
                    checked={audience().includes(member.user_id)}
                    disabled={actions.adopt.isPending}
                    onChange={(checked) =>
                      setAudience((previous) =>
                        checked
                          ? [...previous, member.user_id]
                          : previous.filter((id) => id !== member.user_id)
                      )
                    }
                  >
                    <Checkbox.Control />
                    <Checkbox.Label>
                      {idToDisplayName(member.user_id)}
                    </Checkbox.Label>
                  </Checkbox>
                )}
              </For>
            </fieldset>
          </Show>
          <Show when={groups.isError}>
            <p role="alert" class="text-sm text-ink-muted">
              Check your WhatsApp connection in Settings.{' '}
              <Button size="sm" onClick={() => void groups.refetch()}>
                Try again
              </Button>
            </p>
          </Show>
          <Show when={error()}>
            <p role="alert" class="text-sm text-failure-ink">
              {error()}
            </p>
          </Show>
        </div>
      </Panel.Body>
      <Panel.Footer class="justify-between gap-3 px-6 py-4 sm:px-8">
        <Button
          variant="ghost"
          disabled={actions.adopt.isPending}
          onClick={props.onBack}
        >
          Back
        </Button>
        <div class="flex flex-col items-end gap-2">
          <span class="text-xs text-ink-muted">
            New messages sync from now on.
          </span>
          <Button
            variant="strong"
            disabled={!selected() || !currentTeam() || actions.adopt.isPending}
            onClick={() => void adopt()}
          >
            {actions.adopt.isPending ? 'Connecting…' : 'Connect group'}
          </Button>
        </div>
      </Panel.Footer>
    </>
  );
}
