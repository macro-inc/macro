import { createClient, gql, stringifyDocument } from '@urql/core';
import { getOperationAST, parse, print } from 'graphql';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { filter, map, pipe } from 'wonka';
import { createUrqlQuery } from '../create-urql-query';

const firstDocument = gql`query Soup { value }`;
const secondDocument = gql`query ChannelListSoup { value }`;
const firstText = print(firstDocument);
const secondText = print(secondDocument);
const client = createClient({
  url: 'https://localhost/graphql',
  exchanges: [
    () => (operations) =>
      pipe(
        operations,
        filter((operation) => operation.kind === 'query'),
        map((operation) => ({
          operation,
          data: { value: 'Loaded' },
          stale: false,
          hasNext: false,
        }))
      ),
  ],
});

function Harness() {
  const [document, setDocument] = createSignal(firstDocument);
  const query = createUrqlQuery<{ value: string }, Record<string, never>>(
    () => ({
      client,
      query: document(),
      variables: {},
    })
  );
  const integrity = () => {
    // Observe each new result before inspecting the shared ASTs.
    if (!query.operation) return 'Loading';
    const valid =
      print(firstDocument) === firstText &&
      print(secondDocument) === secondText;
    const textMatchesName = [firstDocument, secondDocument].every(
      (document) => {
        const name = getOperationAST(document)?.name?.value;
        return (
          getOperationAST(parse(stringifyDocument(document)), name) !== null
        );
      }
    );
    return valid && textMatchesName
      ? 'Documents preserved'
      : 'Document corrupted';
  };
  return (
    <main>
      <button type="button" onClick={() => setDocument(firstDocument)}>
        Home
      </button>
      <button type="button" onClick={() => setDocument(secondDocument)}>
        Channels
      </button>
      <output aria-label="Query result">
        {query.data?.value ?? 'Loading'}
      </output>
      <output aria-label="Document integrity">{integrity()}</output>
      <output aria-label="Active operation">
        {query.operation && getOperationAST(query.operation.query)?.name?.value}
      </output>
    </main>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing harness root');
render(() => <Harness />, root);
