import type { Client } from '@urql/core';
import { onCleanup } from 'solid-js';

type SavedViewReader = {
  client: () => Client;
  id?: () => string | undefined;
  refresh: () => Promise<unknown>;
};

const READERS = new Set<SavedViewReader>();

/** Only mounted readers participate in uncached appearance reconciliation. */
export function registerSavedViewReader(reader: SavedViewReader) {
  READERS.add(reader);
  onCleanup(() => READERS.delete(reader));
}

export async function refreshSavedViewReaders(client: Client, id: string) {
  const results = await Promise.allSettled(
    [...READERS]
      .filter(
        (reader) =>
          reader.client() === client && (!reader.id || reader.id() === id)
      )
      .map((reader) => reader.refresh())
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
