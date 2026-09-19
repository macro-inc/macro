import { describe, expect, it } from 'vitest';
import { renderTraceMarkdown, type TraceSession } from './trace-log';

/**
 * Regression tests for the trace renderer crashing on snippet shapes the coder
 * actually produces.
 *
 * `renderTraceMarkdown` called `text.split('\n')` on every snippet value. A
 * coder passing an array — 45 of the 51 non-string snippet values in the prod
 * corpus — threw `text.split is not a function` and took down the render of the
 * ENTIRE trace, so the session became undebuggable at exactly the moment
 * someone wanted to debug it.
 */
function sessionWithSnippets(snippets: unknown): TraceSession {
  return {
    version: 1,
    sessionId: 's1',
    documentId: 'd1',
    prompt: 'do the thing',
    startedAt: new Date('2026-07-30T00:00:00Z').toISOString(),
    steps: [
      {
        inputTokens: 10,
        outputTokens: 5,
        toolCalls: [
          {
            toolName: 'dispatch',
            input: { editing_instruction: 'edit node abc' },
            output: '✓ APPLIED\n\n<document>\n<doc/>\n</document>',
          },
        ],
      },
    ],
    usage: [{ model: 'claude-haiku-4-5', inputTokens: 10, outputTokens: 5 }],
    coderCodeBlocks: [[[{ code: 'editor.setText("a", snippets.x)', snippets: snippets as never }]]],
  } as TraceSession;
}

describe('renderTraceMarkdown snippet rendering', () => {
  it('renders a string snippet', () => {
    const md = renderTraceMarkdown(sessionWithSnippets({ x: 'plain text' }));
    expect(md).toContain('snippets.x');
    expect(md).toContain('plain text');
  });

  it('renders an array snippet instead of throwing', () => {
    const md = renderTraceMarkdown(
      sessionWithSnippets({ items: ['first line', 'second line'] })
    );
    expect(md).toContain('snippets.items');
    expect(md).toContain('first line');
    expect(md).toContain('second line');
  });

  it('renders numeric and object snippet values', () => {
    const md = renderTraceMarkdown(
      sessionWithSnippets({ count: 3, card: { documentId: 'd9' } })
    );
    expect(md).toContain('snippets.count');
    expect(md).toContain('snippets.card');
    expect(md).toContain('d9');
  });

  it('renders when `snippets` itself is a bare string', () => {
    // One prod session sent this; Object.entries over a string walks characters.
    expect(() =>
      renderTraceMarkdown(sessionWithSnippets('not an object' as never))
    ).not.toThrow();
  });

  it('renders a malformed dispatch instruction verbatim rather than crashing', () => {
    const session = sessionWithSnippets({ x: 'ok' });
    (session.steps[0]!.toolCalls[0] as { input: unknown }).input = {
      edits: [{ editing_instruction: 'legacy batch shape' }],
    };
    const md = renderTraceMarkdown(session);
    expect(md).toContain('malformed');
  });
});
