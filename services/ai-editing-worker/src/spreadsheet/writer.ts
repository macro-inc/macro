import { Telemetry } from '@macro-inc/observability';
import type {
  SpreadsheetEditResponse,
  SpreadsheetSheetSummary,
} from '@macro-inc/spreadsheet/ai-types';
import {
  calculateSpreadsheetForAi,
  prepareSpreadsheetEdit,
  readSpreadsheetForAi,
} from '@macro-inc/spreadsheet/ai-workbook';
import type { SpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import { validateSpreadsheetDocument } from '@macro-inc/spreadsheet/document-validation';
import {
  generateText,
  hasToolCall,
  type LanguageModel,
  stepCountIs,
  tool,
} from 'ai';
import { LoroDoc } from 'loro-crdt';
import { z } from 'zod';
import { nextAiPeerId } from '../ai-editing/awareness/ai-peer';
import { TokenTracker, type UsageEntry } from '../ai-editing/token-tracker';
import { SpreadsheetRequestError, type SpreadsheetStorage } from './runtime';
import { spreadsheetOperationSchema } from './schema';
import { SPREADSHEET_WRITER_PROMPT } from './writer-prompt';

const MAX_STEPS = 8;
const MAX_OUTPUT_TOKENS = 4_000;

/** What an edit by instructions left; usage is billed whatever happened. */
export type SpreadsheetWriterResult =
  | ({
      outcome: 'edited';
      usage: UsageEntry[];
    } & Omit<SpreadsheetEditResponse, 'action'>)
  | {
      outcome: 'refused';
      /** What the model needs, or why it cannot do the edit; nothing changed. */
      reason: string;
      usage: UsageEntry[];
    }
  | {
      outcome: 'failed';
      /** What went wrong after the model started. */
      error: string;
      /** The workbook changed while the model worked; nothing was saved. */
      conflict: boolean;
      /** The commit was sent but not confirmed, so the batch may have saved. */
      mayHaveSaved: boolean;
      usage: UsageEntry[];
    };

type PreparedEdit = {
  update: Uint8Array;
  changes: SpreadsheetEditResponse['changes'];
  sheets: SpreadsheetSheetSummary[];
  warnings: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation failed.';
}

/**
 * Carry out natural-language instructions on a native workbook: one model
 * reads and calculates as it needs, then writes one batch that commits once
 * against the revision it read. A concurrent change rejects the commit.
 */
export async function writeSpreadsheetEdit(
  instructions: string,
  storage: SpreadsheetStorage,
  calculator: SpreadsheetCalculator,
  model: LanguageModel,
  signal: AbortSignal
): Promise<SpreadsheetWriterResult> {
  const tracker = new TokenTracker();
  const { snapshot, revision } = await storage.load(signal);
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
    validateSpreadsheetDocument(doc);

    let prepared: PreparedEdit | undefined;
    let blocked: string | undefined;
    let committing = false;
    const tools = {
      readCells: tool({
        description:
          'Read exact cells: sources, formulas, calculated values, display text and, with includeStyles, formatting. At most 500 cells.',
        inputSchema: z.object({
          sheetId: z.string().optional(),
          ranges: z.array(z.string()).min(1).max(20),
          includeStyles: z.boolean().optional(),
        }),
        execute: async (input) => {
          try {
            return readSpreadsheetForAi(
              doc,
              revision,
              { action: 'read', ...input },
              calculator
            );
          } catch (error) {
            return { error: errorMessage(error) };
          }
        },
      }),
      calculate: tool({
        description:
          'Evaluate up to 20 scratch formulas without saving, optionally with hypothetical cell inputs. Each formula is evaluated at A1 of a private sheet.',
        inputSchema: z.object({
          sheetId: z.string().optional(),
          formulas: z
            .array(z.object({ formula: z.string().min(2) }))
            .min(1)
            .max(20),
          overrides: z
            .array(
              z.object({
                sheetId: z.string(),
                cells: z.array(
                  z.object({ address: z.string(), value: z.string() })
                ),
              })
            )
            .max(10)
            .optional(),
        }),
        execute: async (input) => {
          try {
            return calculateSpreadsheetForAi(
              doc,
              revision,
              { action: 'calculate', ...input },
              calculator
            );
          } catch (error) {
            return { error: errorMessage(error) };
          }
        },
      }),
      applyEdits: tool({
        description:
          'Save the whole change as one validated batch. A rejected batch saves nothing; fix it and call again.',
        inputSchema: z.object({
          operations: z.array(spreadsheetOperationSchema).min(1).max(25),
        }),
        execute: async ({ operations }) => {
          try {
            const edit = prepareSpreadsheetEdit(
              doc,
              { action: 'edit', expectedRevision: revision, operations },
              calculator,
              nextAiPeerId()
            );
            prepared = edit;
            return {
              changes: edit.changes,
              warnings: edit.warnings,
            };
          } catch (error) {
            return { error: errorMessage(error) };
          }
        },
      }),
      reportBlocked: tool({
        description:
          'Stop without editing and say what you need to know or why the request cannot be done.',
        inputSchema: z.object({ reason: z.string().min(1) }),
        execute: async ({ reason }) => {
          blocked = reason;
          return { stopped: true };
        },
      }),
    };

    const overview = readSpreadsheetForAi(
      doc,
      revision,
      { action: 'read' },
      calculator
    );
    try {
      const result = await Telemetry.span('spreadsheet.ai.model', () =>
        generateText({
          model,
          system: SPREADSHEET_WRITER_PROMPT,
          prompt: `Request: ${instructions}\n\n<workbook>${JSON.stringify(overview)}</workbook>`,
          tools,
          abortSignal: signal,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          stopWhen: [
            stepCountIs(MAX_STEPS),
            hasToolCall('reportBlocked'),
            () => prepared !== undefined,
          ],
          onStepFinish: (step) => {
            tracker.add({ modelId: step.response.modelId }, step.usage);
          },
        })
      );

      if (!prepared) {
        return {
          outcome: 'refused',
          reason:
            blocked ??
            (result.text ||
              'The editor stopped without a valid change. Say exactly which cells or sheets to change.'),
          usage: tracker.toEntries(),
        };
      }

      signal.throwIfAborted();
      committing = true;
      const committed = await storage.commit(revision, prepared.update, signal);
      return {
        outcome: 'edited',
        ...committed,
        changes: prepared.changes,
        sheets: prepared.sheets,
        warnings: prepared.warnings,
        usage: tracker.toEntries(),
      };
    } catch (error) {
      const rejected =
        error instanceof SpreadsheetRequestError && error.status < 500;
      return {
        outcome: 'failed',
        error: errorMessage(error),
        conflict:
          error instanceof SpreadsheetRequestError && error.status === 409,
        mayHaveSaved: committing && !rejected,
        usage: tracker.toEntries(),
      };
    }
  } finally {
    doc.free();
  }
}
