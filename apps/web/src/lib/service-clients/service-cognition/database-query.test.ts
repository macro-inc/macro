import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('./client', () => ({
  cognitionApiServiceClient: { databaseQuery: generate },
}));

import { generateDatabaseQuery } from './database-query';

const input = {
  prompt: 'Show tickets by status',
  sql: '',
  schema: { databaseId: 'support', name: 'Support', tables: [] },
};
const proposal = {
  answerable: true,
  databaseId: 'support',
  sql: 'SELECT Status, COUNT(*) AS Total FROM Tickets GROUP BY Status',
  explanation: 'Counts tickets.',
  title: 'Tickets by status',
  displayMode: 'bar',
  chart: {
    x: 'Status',
    y: ['Total'],
    title: 'Tickets',
    color: null,
    stack: false,
  },
};
beforeEach(() => generate.mockReset());

describe('database question transport', () => {
  it('sends question inputs to the dedicated endpoint and preserves chart configuration', async () => {
    generate.mockResolvedValue(ok(proposal));
    const result = await generateDatabaseQuery(
      input,
      'google/gemini-3.8-flash'
    );
    expect(generate).toHaveBeenCalledWith({
      model: 'google/gemini-3.8-flash',
      ...input,
    });
    expect(result._unsafeUnwrap()).toEqual(proposal);
    expect(generate.mock.calls[0][0]).not.toHaveProperty('output_schema');
    expect(generate.mock.calls[0][0]).not.toHaveProperty('toolset');
  });
  it('includes a failed proposal and its diagnostic for repair', async () => {
    generate.mockResolvedValue(ok(proposal));
    await generateDatabaseQuery(
      { ...input, sql: 'SELECT bad FROM Tickets', error: 'Unknown column bad' },
      'google/gemini-3.8-flash'
    );
    expect(generate.mock.calls[0][0].error).toBe('Unknown column bad');
    expect(generate.mock.calls[0][0].sql).toBe('SELECT bad FROM Tickets');
  });
  it('preserves service failures including admission and timeout errors', async () => {
    const errors = [
      { code: 'SERVER_ERROR', message: 'The model provider is unavailable.' },
    ];
    generate.mockResolvedValue(err(errors));
    const result = await generateDatabaseQuery(
      input,
      'google/gemini-3.8-flash'
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'service', errors });
  });
});
