import { describe, expect, it } from 'vitest';
import { composeAgentConnectionPrompt } from '../utils/agent-connection-prompt';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';

describe('composeAgentConnectionPrompt', () => {
  it.each([
    ['cursor', 'Cursor', '@cursor'],
    ['codex-cloud', 'Codex', '@codex'],
    ['claude-cloud', 'Claude', '@claude'],
  ])(
    'round-trips the %s setup reply through real Lexical nodes',
    (appSlug, name, agentTag) => {
      const chip = { appSlug, name, target: 'harness' as const };
      const markdown = composeAgentConnectionPrompt({
        agentTag,
        message: 'Connect your account, then mention me again.',
        chip,
      });
      expect(markdown).toBe(
        `\`${agentTag}\` Connect your account, then mention me again. <m-connect-app>${JSON.stringify(chip)}</m-connect-app>`
      );
      const state = markdownToSerializedEditorStateWithIds(markdown);
      expect(state.root.children[0]).toMatchObject({
        type: 'paragraph',
        children: [
          { type: 'text', text: agentTag, format: 16 },
          {
            type: 'text',
            text: ' Connect your account, then mention me again. ',
          },
          { type: 'connect-app', ...chip },
        ],
      });
    }
  );
});
