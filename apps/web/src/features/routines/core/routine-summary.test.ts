import { describe, expect, it } from 'vitest';
import { stepsFromTask } from './routine-steps';
import { instructionsGist, summarizeWork } from './routine-summary';

const steps = (wire: unknown[]) => stepsFromTask({ steps: wire }) ?? [];
const tool = (name: string, args: Record<string, unknown>) => ({
  type: 'tool',
  tool: name,
  arguments: args,
});
const label = (value: string) =>
  tool('UpdateThreadLabels', { thread_id: 't', label: value, add: true });

describe('summarizeWork', () => {
  it('names what AI picks between and counts the actions that follow', () => {
    expect(
      summarizeWork(
        steps([
          {
            type: 'choose',
            options: [
              {
                label: 'Invoice',
                steps: [
                  label('Finance'),
                  tool('CreateDocument', { documentName: 'Pay', isTask: true }),
                ],
              },
              {
                label: 'Newsletter',
                steps: [
                  tool('UpdateThreadLabels', {
                    thread_id: 't',
                    label: 'INBOX',
                    add: false,
                  }),
                ],
              },
            ],
          },
        ]),
        ''
      )
    ).toEqual({ chip: 'AI picks', text: 'Invoice, Newsletter · 3 actions' });
  });

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

  it('names the value AI picks for a pick step', () => {
    expect(
      summarizeWork(
        steps([
          {
            type: 'choose',
            multiple: true,
            options: [
              { label: 'Finance', steps: [label('Finance')] },
              { label: 'Travel', steps: [label('Travel')] },
            ],
          },
        ]),
        ''
      )
    ).toEqual({ chip: 'AI picks', text: 'Labels' });
  });

  it('names the actions that follow a pick', () => {
    expect(
      summarizeWork(
        steps([
          {
            type: 'choose',
            options: [
              { label: 'Finance', steps: [label('Finance')] },
              { label: 'Travel', steps: [label('Travel')] },
            ],
          },
          tool('Comment', { entityId: 't', content: 'Triaged' }),
        ]),
        ''
      )
    ).toEqual({ chip: 'AI picks', text: 'Labels · Comment' });
  });

  it('lists plain actions without a chip', () => {
    expect(
      summarizeWork(
        steps([
          tool('CreateDocument', {
            documentName: 'Weekly report',
            fileContent: '',
            fileExtension: 'md',
            isTask: true,
          }),
        ]),
        ''
      )
    ).toEqual({ text: 'Create task' });
  });
});
