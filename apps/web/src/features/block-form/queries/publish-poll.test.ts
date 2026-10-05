import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishPoll } from './publish-poll';

// The storage client's imports open a realtime socket on load.
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

const storage = vi.hoisted(() => ({
  createForm: vi.fn(),
  putFormLayout: vi.fn(),
  updateForm: vi.fn(),
  applyDatabaseOps: vi.fn(),
}));
vi.mock('@queries/storage/forms', () => ({
  createForm: storage.createForm,
  putFormLayout: storage.putFormLayout,
  updateForm: storage.updateForm,
}));
vi.mock('@queries/storage/databases', () => ({
  applyDatabaseOps: storage.applyDatabaseOps,
}));

const draft = {
  question: 'Lunch?',
  options: ['Pizza', 'Salad'],
  multi: false,
  showResults: true,
};

function created(sections: { id: string; kind: string }[]) {
  return okAsync({
    form: { id: 'form-1', databaseId: 'database-1', tableId: 'table-1' },
    sections,
  });
}

beforeEach(() => {
  for (const mock of Object.values(storage)) mock.mockReset();
});

describe('publishPoll', () => {
  it('trashes the half-made poll when a later step is refused, and says why', async () => {
    storage.createForm.mockReturnValue(
      created([{ id: 'section-1', kind: 'questions' }])
    );
    storage.applyDatabaseOps.mockReturnValue(
      errAsync({ code: 'INVALID_OP', message: 'No.' })
    );
    const discarded: string[] = [];
    const result = await publishPoll(draft, (made) => {
      discarded.push(`${made.formId} ${made.databaseId}`);
      return okAsync(undefined);
    });
    expect(result.isErr()).toBe(true);
    expect(discarded).toEqual(['form-1 database-1']);
  });

  it('refuses, rather than inventing one, when the new form has no section for the question', async () => {
    storage.createForm.mockReturnValue(created([]));
    const discarded: string[] = [];
    const result = await publishPoll(draft, (made) => {
      discarded.push(made.formId);
      return okAsync(undefined);
    });
    expect(result._unsafeUnwrapErr().message).toBe(
      'The new form has no section to hold the question.'
    );
    expect(storage.applyDatabaseOps).not.toHaveBeenCalled();
    expect(discarded).toEqual(['form-1']);
  });
});
