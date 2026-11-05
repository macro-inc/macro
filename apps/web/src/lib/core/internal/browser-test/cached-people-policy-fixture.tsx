import { RecipientSelector } from '@core/component/RecipientSelector';
import type { WithCustomUserInput } from '@core/user/combinedRecipient';
import type { RecipientSourceFactory } from '@core/user/recipient-source';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  EMPTY_PERSON_FACTS,
  type PersonFacts,
} from '@queries/contacts/context-facts';
import { ContactContextPublisher } from '@queries/contacts/context-publisher';
import { createContactDirectoryWindow } from '@queries/contacts/directory-query';
import { createContactRecipientSource } from '@queries/contacts/recipient-window';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { account } from './test-account';

const SHARED_DM = '00000000-0000-4000-8000-000000000001';

/** Production publisher, directory windows and recipient UI over the real cache host. */
export function CachedPeoplePolicyFixture(props: { host: CacheHost }) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal('');
  const [commandOpen, setCommandOpen] = createSignal(false);
  const [selected, setSelected] = createSignal<WithCustomUserInput<'user'>[]>([
    {
      kind: 'custom',
      id: 'macro|outside@example.com',
      data: {
        id: 'macro|outside@example.com',
        email: 'outside@example.com',
        invalid: false,
      },
    },
  ]);
  const viewer = account().userId;
  const scope = () => ({ userId: viewer, host: props.host });
  const now = Date.now();
  const day = 86_400_000;
  const facts = new Map<string, PersonFacts>([
    [
      'macro|person1@example.com',
      {
        ...EMPTY_PERSON_FACTS,
        lastInteractionMs: now - 10 * day,
        directMessage: {
          id: SHARED_DM,
          name: 'Person shared',
          timestampMs: now - 5 * day,
        },
      },
    ],
    [
      'macro|person2@example.com',
      {
        ...EMPTY_PERSON_FACTS,
        lastInteractionMs: now - 10 * day,
        directMessage: {
          id: SHARED_DM,
          name: 'Person shared',
          timestampMs: now - 5 * day,
        },
      },
    ],
    [
      'macro|person3@example.com',
      { ...EMPTY_PERSON_FACTS, secondaryInbox: true },
    ],
    [
      'macro|person4@example.com',
      { ...EMPTY_PERSON_FACTS, lastInteractionMs: now - day },
    ],
    [
      'macro|not-member@example.com',
      {
        ...EMPTY_PERSON_FACTS,
        directMessage: {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'Person context only',
          timestampMs: now,
        },
      },
    ],
  ]);
  let publisher: ContactContextPublisher | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    publisher?.dispose();
  });
  onMount(() =>
    fireAndForget(
      (async () => {
        try {
          if (!props.host.people) throw new Error('Missing person policy');
          publisher = new ContactContextPublisher(
            props.host.people,
            {
              identity: viewer,
              storageGeneration: await props.host.currentStorageGeneration(),
            },
            () => !disposed
          );
          publisher.replace(facts);
          if ((await publisher.flush()) !== 'ready')
            throw new Error('Context not published');
          setReady(true);
        } catch (error) {
          setError(String(error));
        }
      })(),
      'cached-people-policy-fixture'
    )
  );
  const command = createContactDirectoryWindow(
    scope,
    undefined,
    () => ready() && commandOpen(),
    {
      search: () => 'person',
      policy: () => ({ mode: 'command', excluded: [viewer] }),
    }
  );
  const source: RecipientSourceFactory<'user'> = (input) =>
    createContactRecipientSource(scope, input, () => false);
  const updateRecency = async () => {
    publisher?.replace(
      new Map([
        ...facts,
        [
          'macro|person5@example.com',
          { ...EMPTY_PERSON_FACTS, lastInteractionMs: now },
        ],
      ])
    );
    await publisher?.flush();
  };
  return (
    <main class="p-4 bg-page text-ink flex flex-col gap-3">
      <output data-testid="policy-ready">
        {ready() ? 'ready' : error() || 'pending'}
      </output>
      <Show when={ready()}>
        <RecipientSelector
          createSource={source}
          selectedOptions={selected()}
          setSelectedOptions={setSelected}
          placeholder="Recipients"
        />
        <pre data-testid="policy-selections">
          {JSON.stringify(selected().map((item) => item.id))}
        </pre>
        <button
          onClick={() =>
            fireAndForget(updateRecency(), 'cached-people-policy-fixture')
          }
        >
          Update recency
        </button>
        <button onClick={() => setCommandOpen(true)}>
          Read command people
        </button>
        <button onClick={() => command.next()}>Next command people</button>
        <output data-testid="command-count">
          {command.data()?.users.length}
        </output>
        <output data-testid="command-source">{command.data()?.source}</output>
        <output data-testid="command-dm-count">
          {
            command
              .data()
              ?.people?.filter(
                (person) => person.directMessage?.id === SHARED_DM
              ).length
          }
        </output>
        <pre data-testid="command-ids">
          {JSON.stringify(command.data()?.users.map((user) => user.id))}
        </pre>
      </Show>
    </main>
  );
}
