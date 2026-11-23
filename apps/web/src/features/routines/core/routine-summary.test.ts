import type { RoutineStep } from '@service-scheduled-action/generated/schemas';
import { describe, expect, it } from 'vitest';
import { stepsFromWire } from './routine-steps';
import { instructionsGist, summarizeWork } from './routine-summary';

const steps = (wire: RoutineStep[]) => stepsFromWire(wire) ?? [];
const code = (title: string): RoutineStep => ({
  type: 'code',
  title,
  source: 'export async function main() {}',
});

describe('summarizeWork', () => {
  it('gives the gist of what a single agent is asked', () => {
    expect(
      summarizeWork(
        undefined,
        'Summarize my day: today’s meetings and tasks due today.'
      )
    ).toEqual({ chip: 'Ask AI', text: 'Summarize my day' });
    expect(
      instructionsGist(
        'Read <m-document-mention>{"documentId":"d","documentName":"Q3 plan","blockName":"md"}</m-document-mention> and post a summary.'
      )
    ).toBe('Read Q3 plan and post a summary');
  });

  it('names what the code steps do, with the Ask AI chip when AI follows', () => {
    expect(
      summarizeWork(
        steps([code('Label invoices'), code('Archive newsletters')]),
        ''
      )
    ).toEqual({ text: 'Label invoices · Archive newsletters' });
    expect(
      summarizeWork(
        steps([
          code('Find stuck tasks'),
          { type: 'agent', model: 'm', instructions: 'Write a summary.' },
        ]),
        ''
      )
    ).toEqual({ chip: 'Ask AI', text: 'Find stuck tasks' });
    expect(
      summarizeWork(
        steps([
          { type: 'agent', model: 'm', instructions: 'Write a summary.' },
        ]),
        ''
      )
    ).toEqual({ chip: 'Ask AI', text: 'Write a summary' });
    expect(summarizeWork([], '')).toEqual({ text: 'No steps' });
  });
});
