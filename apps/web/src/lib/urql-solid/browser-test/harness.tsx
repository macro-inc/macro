import { createClient, gql, stringifyDocument } from '@urql/core';
import { getOperationAST, parse, print } from 'graphql';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { filter, map, pipe } from 'wonka';
import { createUrqlQuery } from '../create-urql-query';

const FIRST_DOCUMENT = gql`query Soup { value }`;
const SECOND_DOCUMENT = gql`query ChannelListSoup { value }`;
const FIRST_TEXT = print(FIRST_DOCUMENT);
const SECOND_TEXT = print(SECOND_DOCUMENT);
const CLIENT = createClient({
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
  const [document, setDocument] = createSignal(FIRST_DOCUMENT);
  const query = createUrqlQuery<{ value: string }, Record<string, never>>(
    () => ({
      client: CLIENT,
      query: document(),
      variables: {},
    })
  );
  const integrity = () => {
    // Observe each new result before inspecting the shared ASTs.
    if (!query.operation) return 'Loading';
    const valid =
      print(FIRST_DOCUMENT) === FIRST_TEXT &&
      print(SECOND_DOCUMENT) === SECOND_TEXT;
    const textMatchesName = [FIRST_DOCUMENT, SECOND_DOCUMENT].every(
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
      <button type="button" onClick={() => setDocument(FIRST_DOCUMENT)}>
        Home
      </button>
      <button type="button" onClick={() => setDocument(SECOND_DOCUMENT)}>
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

const ROOT = document.getElementById('app');
if (!ROOT) throw new Error('Missing harness root');
render(() => <Harness />, ROOT);
