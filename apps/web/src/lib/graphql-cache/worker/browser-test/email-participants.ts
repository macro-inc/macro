import { createWorkerCacheHost } from '../../host/worker-host';

const result = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#load')!;
const query = `query Senders($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename id
        ... on GraphqlSoupEmailThread {
          participants: senders { contactId linkId name email sfsPhotoUrl }
        }
      }
      nextCursor
    }
  }
}`;
const variables = { input: { limit: 1 } };
const page = (id: string, names: string[]) => ({
  user: {
    id: 'user-1',
    soup: {
      items: [
        {
          __typename: 'GraphqlSoupEmailThread',
          id,
          participants: names.map((name) => ({
            contactId: 'github-notifications',
            linkId: 'inbox-1',
            email: 'notifications@github.com',
            name,
            sfsPhotoUrl: null,
          })),
        },
      ],
      nextCursor: null,
    },
  },
});
const original = page('thread-1', [
  'Sean Aye',
  'coderabbitai[bot]',
  'cursor[bot]',
]);
const host = createWorkerCacheHost({
  scope: `sender-names-${crypto.randomUUID()}`,
});

async function display(status: string) {
  const read = await host.readQuery({
    query,
    operationName: 'Senders',
    variables,
  });
  if (read.kind !== 'hit')
    throw new Error(`Expected a cache hit: ${read.kind}`);
  const cached = read.data as ReturnType<typeof page>;
  const names = cached.user.soup.items[0].participants.map(({ name }) => name);
  if (names.join(',') !== 'Sean Aye,coderabbitai[bot],cursor[bot]') {
    throw new Error(`Sender names changed: ${JSON.stringify(read.data)}`);
  }
  result.textContent = JSON.stringify(read.data, null, 2);
  result.dataset.status = status;
}

function fail(error: unknown) {
  result.textContent = String(error);
  result.dataset.status = 'failed';
}

button.onclick = async () => {
  try {
    await host.writeQuery({
      query,
      operationName: 'Senders',
      variables: { input: { limit: 1, cursor: 'next' } },
      identity: 'user-1',
      data: page('thread-2', ['Wolf Mermelstein']),
    });
    await display('passed');
  } catch (error) {
    fail(error);
  }
};

try {
  await host.writeQuery({
    query,
    operationName: 'Senders',
    variables,
    identity: 'user-1',
    data: original,
  });
  await display('ready');
  button.disabled = false;
} catch (error) {
  fail(error);
}
