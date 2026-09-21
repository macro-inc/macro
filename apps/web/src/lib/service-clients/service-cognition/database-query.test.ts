import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QueryActionError,
  QueryOutcomeUnknownError,
} from '../../../features/database-query/core/query';

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('./client', () => ({
  cognitionApiServiceClient: { structuredCompletion: complete },
}));
vi.mock('@core/component/AI/constant', () => ({
  DEFAULT_MODEL: 'anthropic/claude-sonnet-5',
}));

import { generateDatabaseQuery, runDatabaseAssistant } from './database-query';
import { summarizeDatabaseActivity } from './database-tool-activity';

const input = {
  prompt: 'Show tickets by status',
  sql: '',
  schema: {
    databaseId: 'support',
    name: 'Support',
    focusTableId: 'tickets',
    tables: [],
  },
};
const proposal = {
  answerable: true,
  sql: 'SELECT status, COUNT(*) AS total FROM tickets GROUP BY status',
  explanation: 'Tickets by status.',
  displayMode: 'bar',
  chart: { x: 'status', y: ['total'], title: 'Tickets' },
};
beforeEach(() => complete.mockReset());

describe('database AI transport boundaries', () => {
  it('gives document questions only read-only discovery and preserves chart configuration', async () => {
    complete.mockResolvedValue(ok({ result: proposal, toolActivity: [] }));
    const result = await generateDatabaseQuery(input);
    expect(complete.mock.calls[0][0].toolset).toEqual({
      type: 'databases_read_only',
    });
    expect(JSON.parse(complete.mock.calls[0][0].prompt).schema).toEqual(
      input.schema
    );
    expect(result.chart).toEqual(proposal.chart);
    expect(result.displayMode).toBe('bar');
  });

  it('only attaches completed changes from server receipts to the scoped assistant', async () => {
    complete.mockResolvedValue(
      ok({
        result: { ...proposal, actionSummary: 'Invented changes' },
        toolActivity: [
          { name: 'CreateTable', success: true },
          { name: 'AddColumn', success: false },
          { name: 'QueryDatabase', success: true, changesApplied: 2 },
        ],
      })
    );
    const result = await runDatabaseAssistant(input);
    expect(complete.mock.calls[0][0].toolset).toEqual({ type: 'databases' });
    expect(result.actionSummary).toBe(
      'Created 1 table · Applied 2 row changes.'
    );
  });

  it('reports committed changes even when the follow-up answer is incomplete', async () => {
    complete.mockResolvedValue(
      ok({
        result: {
          answerable: false,
          sql: '',
          explanation: 'The follow-up query failed.',
        },
        toolActivity: [{ name: 'SaveDatabaseView', success: true }],
      })
    );
    const error = await runDatabaseAssistant(input).catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(QueryActionError);
    expect(error).toMatchObject({
      actionSummary: 'Saved 1 view.',
      message: 'The follow-up query failed.',
    });
  });

  it('does not claim changes for read-only calls, errors or unsupported tool names', () => {
    expect(
      summarizeDatabaseActivity([
        { name: 'CreateTable', success: false },
        { name: 'QueryDatabase', success: true, changesApplied: 0 },
        { name: 'SendEmail', success: true },
      ])
    ).toBeUndefined();
  });

  it('keeps server errors visible without fabricating a proposal', async () => {
    complete.mockResolvedValue(
      err([{ message: 'Access denied', code: 'FORBIDDEN' }])
    );
    await expect(runDatabaseAssistant(input)).rejects.toThrow('Access denied');
  });

  it('marks lost responses as uncertain instead of allowing an unchanged write retry', async () => {
    complete.mockResolvedValue(
      err([{ message: 'Network error', code: 'NETWORK_ERROR' }])
    );
    await expect(runDatabaseAssistant(input)).rejects.toBeInstanceOf(
      QueryOutcomeUnknownError
    );
  });
});
