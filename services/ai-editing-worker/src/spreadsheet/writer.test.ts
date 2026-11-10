import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import { initSync } from '@ironcalc/wasm';
import {
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from '@macro-inc/spreadsheet/calculation';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from '@macro-inc/spreadsheet/spreadsheet-document';
import { MockLanguageModelV3 } from 'ai/test';
import { LoroDoc } from 'loro-crdt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SpreadsheetRequestError, type SpreadsheetStorage } from './runtime';
import { writeSpreadsheetEdit } from './writer';

let calculator: SpreadsheetCalculator;
const docs: LoroDoc[] = [];
beforeAll(() => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  });
  calculator = createInitializedSpreadsheetCalculator();
});
afterAll(() => {
  calculator.dispose();
  for (const doc of docs) doc.free();
});

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: 100,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

function workbook() {
  const doc = new LoroDoc();
  docs.push(doc);
  doc.getMap('spreadsheetMeta').set('formatVersion', 1);
  writeSpreadsheetCells(doc, {
    A1: { value: 'Item' },
    B1: { value: 'Cost' },
    A2: { value: 'Rent' },
    B2: { value: '1200' },
    A3: { value: 'Food' },
    B3: { value: '300' },
  });
  const revision = () => Buffer.from(doc.version().encode()).toString('base64');
  const storage: SpreadsheetStorage = {
    load: vi.fn(async () => ({
      snapshot: doc.export({ mode: 'snapshot' }),
      revision: revision(),
    })),
    commit: vi.fn(async (expected, update) => {
      if (expected !== revision())
        throw new SpreadsheetRequestError('The spreadsheet changed.', 409);
      doc.import(update);
      return { revision: revision(), applied: true };
    }),
  };
  return { doc, storage };
}

/** A model that answers each step with the next scripted tool call. */
function scriptedModel(calls: { toolName: string; input: unknown }[]) {
  let step = 0;
  return new MockLanguageModelV3({
    modelId: 'writer-mock',
    doGenerate: async () => {
      const call = calls[step];
      step++;
      if (!call)
        return {
          content: [{ type: 'text' as const, text: 'Done.' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage,
          warnings: [],
        };
      return {
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: `call-${step}`,
            toolName: call.toolName,
            input: JSON.stringify(call.input),
          },
        ],
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

const signal = () => new AbortController().signal;

describe('spreadsheet writer', () => {
  it('fixes a rejected batch, commits once and bills every step', async () => {
    const { doc, storage } = workbook();
    const model = scriptedModel([
      { toolName: 'readCells', input: { ranges: ['A1:B3'] } },
      {
        toolName: 'applyEdits',
        input: {
          operations: [
            {
              type: 'set_cells',
              sheetId: 'Missing',
              cells: [{ address: 'A4', value: 'Total' }],
            },
          ],
        },
      },
      {
        toolName: 'applyEdits',
        input: {
          operations: [
            {
              type: 'set_cells',
              sheetId: 'sheet1',
              cells: [
                { address: 'A4', value: 'Total' },
                { address: 'B4', value: '=SUM(B2:B3)' },
              ],
            },
          ],
        },
      },
    ]);

    const result = await writeSpreadsheetEdit(
      'Add a total row under the costs.',
      storage,
      calculator,
      model,
      signal()
    );

    expect(result.outcome).toBe('edited');
    expect(storage.commit).toHaveBeenCalledTimes(1);
    expect(readSpreadsheetCells(doc).B4?.value).toBe('=SUM(B2:B3)');
    expect(result.usage).toEqual([
      { model: 'writer-mock', inputTokens: 300, outputTokens: 60 },
    ]);
  });

  it('refuses without saving when the model reports it is blocked', async () => {
    const { storage } = workbook();
    const model = scriptedModel([
      {
        toolName: 'reportBlocked',
        input: { reason: 'There is no "Revenue" sheet.' },
      },
    ]);

    const result = await writeSpreadsheetEdit(
      'Total the Revenue sheet.',
      storage,
      calculator,
      model,
      signal()
    );

    expect(result).toEqual({
      outcome: 'refused',
      reason: 'There is no "Revenue" sheet.',
      usage: [{ model: 'writer-mock', inputTokens: 100, outputTokens: 20 }],
    });
    expect(storage.commit).not.toHaveBeenCalled();
  });

  it('reports a concurrent change as a conflict that saved nothing', async () => {
    const { doc, storage } = workbook();
    const model = new MockLanguageModelV3({
      modelId: 'writer-mock',
      doGenerate: async () => {
        // Someone types while the model works.
        writeSpreadsheetCells(doc, { C1: { value: 'Notes' } });
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName: 'applyEdits',
              input: JSON.stringify({
                operations: [{ type: 'add_sheet', name: 'Summary' }],
              }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage,
          warnings: [],
        };
      },
    });

    const result = await writeSpreadsheetEdit(
      'Add a Summary sheet.',
      storage,
      calculator,
      model,
      signal()
    );

    expect(result).toMatchObject({
      outcome: 'failed',
      conflict: true,
      mayHaveSaved: false,
    });
    expect(result.usage).toHaveLength(1);
  });
});
