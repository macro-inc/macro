import { RecipientSelector } from '@core/component/RecipientSelector';
import type { WithCustomUserInput } from '@core/user/combinedRecipient';
import type { RecipientSourceFactory } from '@core/user/recipient-source';
import type { readContactDirectory } from '@queries/contacts/directory';
import { createContactRecipientSource } from '@queries/contacts/recipient-window';
import { hashKey, useQueryClient } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';

export function RecipientDirectoryFixture() {
  const client = useQueryClient();
  const [reads, setReads] = createSignal(0);
  const [queryCount, setQueryCount] = createSignal(0);
  onCleanup(
    client
      .getQueryCache()
      .subscribe(() => setQueryCount(client.getQueryCache().getAll().length))
  );
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
  const [loaded, setLoaded] = createSignal(0);
  const reader: typeof readContactDirectory = async (
    viewer,
    _host,
    request
  ) => {
    setReads((value) => value + 1);
    const offset =
      request.cursor?.source === 'people' ? Number(request.cursor.after) : 0;
    const ids =
      request.query === 'rare'
        ? [99_999]
        : request.query === 'empty'
          ? offset
            ? [99_998]
            : []
          : request.query
            ? []
            : Array.from(
                { length: Math.min(50, 100_000 - offset) },
                (_, index) => offset + index
              );
    const hasNext =
      (!request.query && offset + ids.length < 100_000) ||
      (request.query === 'empty' && !offset);
    setLoaded(ids.length);
    return {
      source: 'cache',
      sync: 'partial',
      offline: false,
      query: request.query,
      users: ids.map((id) => ({
        id: `macro|person${id}@example.com`,
        email: `person${id}@example.com`,
        name:
          id === 99_999
            ? 'Rare Person'
            : id === 99_998
              ? 'Empty later'
              : `Person ${String(id).padStart(6, '0')}`,
      })),
      nextCursor: hasNext
        ? {
            source: 'people',
            generation: 'fixture',
            after: String(offset + 50),
            userId: viewer,
            query: request.query,
            policyKey: hashKey([request.policy]),
          }
        : null,
    };
  };
  const createSource: RecipientSourceFactory<'user'> = (input) =>
    createContactRecipientSource(
      () => ({ userId: 'macro|viewer@example.com' }),
      input,
      () => false,
      reader
    );
  return (
    <main class="p-6 max-w-xl bg-page text-ink min-h-screen">
      <RecipientSelector
        createSource={createSource}
        selectedOptions={selected()}
        setSelectedOptions={setSelected}
        placeholder="Recipients"
      />
      <pre data-testid="recipients">
        {JSON.stringify(selected().map((item) => item.id))}
      </pre>
      <output data-testid="reads">{reads()}</output>
      <output data-testid="loaded">{loaded()}</output>
      <output data-testid="queries">{queryCount()}</output>
      <button type="button" class="fixed bottom-4 right-4">
        Outside picker
      </button>
    </main>
  );
}
