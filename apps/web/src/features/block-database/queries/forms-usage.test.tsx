import { queryClient } from '@queries/client';
import { render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { okAsync } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import { tableDeleteConsequence } from '../../database/core/forms-usage';
import { useFormsOverTables } from './forms-usage';

// The storage client's imports reach the realtime connection.
vi.hoisted(() => {
  class FakeWebSocket {
    url: string;
    readyState = 1;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
// This viewer is outside the forms rollout; a flagged owner attached a form.
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    forms: {
      listForDatabase: () =>
        okAsync([{ id: 'form-1', name: 'RSVP', tableId: 'table-1' }]),
    },
  },
}));

it('warns that deleting a table deletes its forms, whatever the viewer’s forms flag', async () => {
  let line: () => string | undefined = () => undefined;
  render(() => (
    <QueryClientProvider client={queryClient}>
      {(() => {
        const over = useFormsOverTables(() => 'database-1');
        line = () => tableDeleteConsequence(over('table-1'));
        return null;
      })()}
    </QueryClientProvider>
  ));
  await waitFor(() =>
    expect(line()).toBe(
      'The form “RSVP” writes to it and will be deleted with it.'
    )
  );
});
