import type { ModelMessage, ToolResultPart } from 'ai';
import { describe, expect, it } from 'vitest';
import { compactDocumentHistory } from './compact';

let nextCallId = 0;

function toolMessage(output: ToolResultPart['output']): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: `c${nextCallId++}`,
        toolName: 'dispatch',
        output,
      },
    ],
  };
}

/** A dispatch result: status line, then the post-edit document. */
const toolResult = (text: string): ModelMessage =>
  toolMessage({ type: 'text', value: text });

const doc = (body: string) => `✓ APPLIED\n\n<document>\n${body}\n</document>`;

function output(message: ModelMessage): ToolResultPart['output'] {
  if (message.role !== 'tool') throw new Error('not a tool message');
  const part = message.content[0];
  if (part?.type !== 'tool-result') throw new Error('not a tool result');
  return part.output;
}

function text(message: ModelMessage): string {
  const out = output(message);
  if (out.type !== 'text') throw new Error(`expected text, got ${out.type}`);
  return out.value;
}

describe('compactDocumentHistory', () => {
  it('leaves a single document untouched', () => {
    const messages = [toolResult(doc('one'))];
    expect(compactDocumentHistory(messages)).toBe(messages);
  });

  it('leaves messages with no documents untouched', () => {
    const messages = [toolResult('ok'), toolResult('ok')];
    expect(compactDocumentHistory(messages)).toBe(messages);
  });

  it('elides all but the newest document', () => {
    const out = compactDocumentHistory([
      toolResult(doc('FIRST')),
      toolResult(doc('SECOND')),
      toolResult(doc('THIRD')),
    ]);

    expect(text(out[0]!)).not.toContain('FIRST');
    expect(text(out[0]!)).toContain('omitted');
    expect(text(out[1]!)).not.toContain('SECOND');
    // The live state survives verbatim.
    expect(text(out[2]!)).toContain('<document>');
    expect(text(out[2]!)).toContain('THIRD');
  });

  it('keeps the summary that precedes the document', () => {
    const out = compactDocumentHistory([
      toolResult(doc('a')),
      toolResult(doc('b')),
    ]);
    expect(text(out[0]!)).toContain('✓ APPLIED');
  });

  it('ignores non-text outputs', () => {
    const messages = [
      toolMessage({ type: 'json', value: { doc: doc('a') } }),
      toolResult(doc('b')),
      toolResult(doc('c')),
    ];
    const out = compactDocumentHistory(messages);
    expect(out[0]).toBe(messages[0]);
    expect(text(out[1]!)).toContain('omitted');
  });

  it('elides every stale part of a multi-result message', () => {
    const part = (value: string, id: string): ToolResultPart => ({
      type: 'tool-result',
      toolCallId: id,
      toolName: 'dispatch',
      output: { type: 'text', value },
    });
    const out = compactDocumentHistory([
      {
        role: 'tool',
        content: [part(doc('a'), 'c-a'), part(doc('b'), 'c-b')],
      },
      toolResult(doc('c')),
    ]);
    const parts = out[0]!.content as ToolResultPart[];
    for (const p of parts) {
      expect(p.output.type === 'text' && p.output.value).toContain('omitted');
    }
  });

  it('does not mutate the input', () => {
    const messages = [toolResult(doc('a')), toolResult(doc('b'))];
    const before = JSON.stringify(messages);
    compactDocumentHistory(messages);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it('is idempotent', () => {
    const once = compactDocumentHistory([
      toolResult(doc('a')),
      toolResult(doc('b')),
      toolResult(doc('c')),
    ]);
    expect(JSON.stringify(compactDocumentHistory(once))).toBe(
      JSON.stringify(once)
    );
  });
});
