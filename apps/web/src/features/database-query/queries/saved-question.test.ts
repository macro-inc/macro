import { okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { type SaveQuestionSql, saveQuestion } from './saved-question';

describe('saving a document question', () => {
  it('saves new SQL as a new query and stores only its id', async () => {
    const save = vi.fn<SaveQuestionSql>(() => okAsync('new-query'));
    const question = await saveQuestion({
      definition: {
        databaseId: 'db',
        sql: 'SELECT COUNT(*) FROM "Projects"',
        prompt: 'How many projects?',
        title: 'Projects',
        displayMode: 'scalar',
      },
      save,
    });
    expect(save).toHaveBeenCalledExactlyOnceWith({
      sql: 'SELECT COUNT(*) FROM "Projects"',
      databaseId: 'db',
    });
    expect(question._unsafeUnwrap()).toEqual({
      queryId: 'new-query',
      databaseId: 'db',
      prompt: 'How many projects?',
      title: 'Projects',
      displayMode: 'scalar',
    });
  });
});
