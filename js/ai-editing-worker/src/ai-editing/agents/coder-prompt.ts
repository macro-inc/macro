import type { SnippetSource } from '../runtime';

export function buildPrompt(
  task: string,
  context: string,
  snippets?: SnippetSource
): string {
  const verbatim: Record<string, string> = {};
  const pending: Array<[key: string, brief: string]> = [];
  for (const [key, value] of Object.entries(snippets ?? {})) {
    if (typeof value === 'string') verbatim[key] = value;
    else pending.push([key, value.brief]);
  }
  const snippetBlock =
    Object.keys(verbatim).length > 0
      ? [
          '\n\nSnippets (access as `snippets.KEY` in your code -- do NOT re-embed as string literals):',
          '```js',
          `const snippets = \n${JSON.stringify(verbatim, null, 2)}`,
          '```',
        ].join('\n')
      : '';
  const pendingBlock =
    pending.length > 0
      ? [
          '\n\nSnippets still being composed for you -- reference them as `snippets.KEY` exactly like the others; the finished text is injected when your code runs:',
          ...pending.map(([key, brief]) => `- \`snippets.${key}\` -- ${brief}`),
        ].join('\n')
      : '';
  const contextBlock = `\n\nRelevant region of the document:\n<document>\n${context}\n</document>`;
  return `Carry out this edit task in full:\n${task}${snippetBlock}${pendingBlock}${contextBlock}`;
}
