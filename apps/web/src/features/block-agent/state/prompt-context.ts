import { isAgentContextData } from '@macro-inc/lexical-core';

/** Only a valid leading context node becomes a control line. */
export function splitPromptContext(text: string): {
  context?: string;
  text: string;
} {
  const match = text.match(
    /^<m-agent-context>(.*?)<\/m-agent-context>(?:\r?\n\r?\n)?/s
  );
  if (!match) return { text };
  try {
    const data: unknown = JSON.parse(match[1]);
    if (!isAgentContextData(data) || Object.keys(data).length !== 2)
      return { text };
    return { context: data.text, text: text.slice(match[0].length) };
  } catch {
    return { text };
  }
}
