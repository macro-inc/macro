import { describe, expect, it } from 'vitest';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { Doc } from '../doc/doc';
import { createRunCodeTool } from './run-code';

/**
 * The SHAPES of every non-string snippet value seen in the production corpus.
 *
 * Content is synthetic on purpose — the corpus text is real user documents, and
 * only the shape is what the schema has to accept. All 51 non-string snippet
 * values across 495 prod sessions are one of these.
 * The strict `Record<string, string>` schema rejected every one, and a rejected
 * tool call costs the coder its whole step — it has to retry from scratch.
 */
const REAL_PROD_SNIPPETS = {
  'array of strings (45 of 51 occurrences)': {
    items: ['first list entry', 'second list entry'],
  },
  'array with a single entry': { listItems: ['only entry'] },
} as const;

function setup() {
  const session = createEditingSession();
  loadMarkdown(session, 'hello world');
  const applied: unknown[] = [];
  const tool = createRunCodeTool({
    session,
    doc: new Doc(session),
    awarenessSource: mockAwarenessSource(),
    runner: (_ids, _code, snippets) => {
      applied.push(snippets);
      return [];
    },
  });
  return { tool, applied };
}

const callOptions = { toolCallId: 'c1', messages: [] } as never;

/** `tool()` widens inputSchema to FlexibleSchema; we know it's the zod object. */
function schemaOf(tool: ReturnType<typeof createRunCodeTool>) {
  return tool.inputSchema as unknown as {
    safeParse: (v: unknown) => { success: boolean };
  };
}

describe('runCode snippets', () => {
  it('accepts a plain string record', () => {
    const parsed = schemaOf(setup().tool).safeParse({
      code: 'editor.setText("a", snippets.body)',
      snippets: { body: 'text' },
    });
    expect(parsed.success).toBe(true);
  });

  for (const [name, snippets] of Object.entries(REAL_PROD_SNIPPETS)) {
    it(`accepts ${name}`, () => {
      const parsed = schemaOf(setup().tool).safeParse({
        code: 'editor.setText("a", snippets.items)',
        snippets,
      });
      expect(parsed.success).toBe(true);
    });
  }

  it('joins array values with newlines before the sandbox sees them', async () => {
    const { tool, applied } = setup();
    await tool.execute!(
      {
        code: 'editor.setText("a", snippets.items)',
        snippets: { items: ['first', 'second'] },
      },
      callOptions
    );
    // The sandbox exposes `snippets` as plain strings, and every editor
    // primitive takes text — joining is what the coder meant by passing a list.
    expect(applied[0]).toEqual({ items: 'first\nsecond' });
  });

  it('leaves string values untouched', async () => {
    const { tool, applied } = setup();
    await tool.execute!(
      { code: 'editor.setText("a", snippets.body)', snippets: { body: 'x\ny' } },
      callOptions
    );
    expect(applied[0]).toEqual({ body: 'x\ny' });
  });

  it('still rejects a value that is neither string nor string[]', () => {
    const parsed = schemaOf(setup().tool).safeParse({
      code: 'x',
      snippets: { body: { nested: true } },
    });
    expect(parsed.success).toBe(false);
  });
});
