import { describe, expect, it } from 'vitest';
import { splitPromptContext } from './prompt-context';

describe('splitPromptContext', () => {
  const node =
    '<m-agent-context>{"version":1,"text":"Full context"}</m-agent-context>';

  it('preserves the full context and remaining prompt', () => {
    expect(splitPromptContext(`${node}\n\nHello`)).toEqual({
      context: 'Full context',
      text: 'Hello',
    });
  });

  it.each([
    'Hello',
    `Hello ${node}`,
    '<m-agent-context>malformed</m-agent-context>',
    '<m-agent-context>{"version":2,"text":"Unknown version"}</m-agent-context>',
    '<m-agent-context>{"version":1,"text":"Context","extra":"Keep me"}</m-agent-context>',
    '&lt;m-agent-context&gt;escaped&lt;/m-agent-context&gt;',
  ])('leaves ordinary or invalid text visible: %s', (text) => {
    expect(splitPromptContext(text)).toEqual({ text });
  });
});
