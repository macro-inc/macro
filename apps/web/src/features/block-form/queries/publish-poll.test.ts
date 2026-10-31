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
  createDatabaseColumn: vi.fn(),
}));
vi.mock('@queries/storage/forms', () => ({
  createForm: storage.createForm,
  putFormLayout: storage.putFormLayout,
  updateForm: storage.updateForm,
}));
vi.mock('@block-database/queries/columns', () => ({
  createDatabaseColumn: storage.createDatabaseColumn,
}));

const draft = {
  question: 'Lunch?',
  options: ['Pizza', 'Salad'],
  multi: false,
  showResults: true,
  shareResponses: false,
  anonymous: false,
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
    storage.createDatabaseColumn.mockReturnValue(
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
    expect(storage.createDatabaseColumn).not.toHaveBeenCalled();
    expect(discarded).toEqual(['form-1']);
  });
});

it('patches tally, shared responses and anonymity after the layout is valid', async () => {
  storage.createForm.mockReturnValue(
    created([{ id: 'section-1', kind: 'questions' }])
  );
  storage.createDatabaseColumn.mockReturnValue(okAsync('column-1'));
  storage.putFormLayout.mockReturnValue(okAsync({ detail: { sections: [] } }));
  storage.updateForm.mockReturnValue(okAsync(undefined));
  const result = await publishPoll(
    {
      question: 'Lunch?',
      options: ['Pizza', 'Salad'],
      multi: false,
      showResults: false,
      shareResponses: true,
      anonymous: true,
    },
    () => okAsync(undefined)
  );
  expect(result.isOk()).toBe(true);
  expect(storage.updateForm).toHaveBeenCalledWith('form-1', {
    tallyVisible: false,
    responsesVisible: true,
    respondentHidden: true,
  });
});

it('rejects duplicate options without creating a form or silently dropping a choice', async () => {
  const result = await publishPoll(
    {
      question: 'Lunch?',
      options: ['Pizza', ' pizza ', 'Salad'],
      multi: false,
      showResults: true,
      shareResponses: false,
      anonymous: false,
    },
    () => okAsync(undefined)
  );
  expect(result._unsafeUnwrapErr().message).toBe(
    'Each option needs a different name.'
  );
  expect(storage.createForm).not.toHaveBeenCalled();
});
