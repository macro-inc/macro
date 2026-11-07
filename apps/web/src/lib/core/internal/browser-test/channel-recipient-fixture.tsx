import { ParticipantsAddPanel } from '@app/features/channel/Participants/ParticipantsAddPanel';
import { ChannelInviteModal } from '@app/features/channel/views/channel-invite-modal';
import type { RecipientSourceFactory } from '@core/user/recipient-source';
import type { ChannelParticipant } from '@queries/channel/types';
import type { readContactDirectory } from '@queries/contacts/directory';
import { createContactRecipientSource } from '@queries/contacts/recipient-window';
import { hashKey } from '@tanstack/solid-query';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';

export function ChannelRecipientFixture() {
  const [open, setOpen] = createSignal(false);
  const [members, setMembers] = createSignal([
    'macro|viewer@example.com',
    'macro|person0@example.com',
  ]);
  const [added, setAdded] = createSignal<string[]>([]);
  const [requests, setRequests] = createSignal(0);
  const [excluded, setExcluded] = createSignal<readonly string[]>([]);
  const participants = createMemo(() =>
    members().map(
      (user_id): ChannelParticipant => ({
        user_id,
        channel_id: '00000000-0000-4000-8000-000000000001',
        joined_at: '2026-01-01T00:00:00Z',
        role: 'member',
      })
    )
  );
  const read: typeof readContactDirectory = async (
    viewer,
    _host,
    request,
    signal
  ) => {
    signal.throwIfAborted();
    setRequests((count) => count + 1);
    setExcluded(request.policy?.excluded ?? []);
    const exclude = new Set(request.policy?.excluded);
    let position =
      request.cursor?.source === 'server' ? Number(request.cursor.after) : 0;
    const users = [];
    if (request.query === 'late') position = 99_999;
    while (
      position < 100_000 &&
      users.length < 50 &&
      (!request.query || request.query === 'late')
    ) {
      const i = position++;
      const id = `macro|person${i}@example.com`;
      if (!exclude.has(id))
        users.push({
          id,
          email: `person${i}@example.com`,
          name: i === 99_999 ? 'Late person' : `Person ${i}`,
        });
    }
    return {
      source: 'server',
      sync: 'unavailable',
      offline: false,
      query: request.query,
      users,
      nextCursor:
        !request.query && position < 100_000
          ? {
              source: 'server',
              after: String(position),
              userId: viewer,
              query: request.query,
              policyKey: hashKey([request.policy]),
            }
          : null,
    };
  };
  const source: RecipientSourceFactory<'user'> = (input) =>
    createContactRecipientSource(
      () => ({ userId: 'macro|viewer@example.com' }),
      input,
      () => false,
      read
    );
  const add = (ids: string[]) => {
    setAdded(ids);
    setMembers((old) => [...old, ...ids]);
  };
  const joined = () =>
    setMembers((old) => [...old, 'macro|person99999@example.com']);
  window.addEventListener('fixture-member-joined', joined);
  onCleanup(() => window.removeEventListener('fixture-member-joined', joined));
  const panel =
    new URLSearchParams(location.search).get('channel-recipients') === 'panel';
  return (
    <main class="p-6 min-h-screen bg-page text-ink">
      <button onClick={() => setOpen(true)}>Open participant picker</button>
      <Show when={open()}>
        <Show
          when={panel}
          fallback={
            <ChannelInviteModal
              channelName="Example channel"
              participantIds={members()}
              participantsReady
              team={{
                name: 'Example team',
                memberIds: [
                  'macro|person0@example.com',
                  'macro|teammate@example.com',
                ],
              }}
              teamLoading={false}
              teamError={false}
              createSource={source}
              onAdd={async (ids) => add(ids)}
              onClose={() => setOpen(false)}
            />
          }
        >
          <ParticipantsAddPanel
            participants={participants}
            createSource={source}
            onAddParticipants={add}
          />
          <button onClick={() => setOpen(false)}>
            Close participant picker
          </button>
        </Show>
      </Show>
      <output data-testid="requests">{requests()}</output>
      <output data-testid="excluded">{JSON.stringify(excluded())}</output>
      <output data-testid="added">{JSON.stringify(added())}</output>
    </main>
  );
}
