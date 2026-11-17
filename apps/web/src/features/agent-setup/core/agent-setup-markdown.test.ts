import { describe, expect, it } from 'vitest';
import {
  type AgentSetupCopy,
  agentSetupMarkdown,
  markdownParts,
} from './agent-setup-markdown';

const COPY = new Proxy({} as AgentSetupCopy, {
  get: (_, key) => String(key),
});

describe('agentSetupMarkdown', () => {
  it('sends the agent through macrod setup with clickable docs and source', () => {
    const markdown = agentSetupMarkdown({
      copy: COPY,
      apiKey: 'token',
      teamJoinFailed: false,
      openAppUrl: 'https://app.test/done',
    });

    expect(markdown).toContain(
      '--config ~/.macrod/agent.toml --agent <agent id>'
    );
    expect(markdown).toContain("harnesses.pairing('<code>').approve()");
    expect(
      markdownParts(markdown).flatMap((part) =>
        part.t === 'link' ? [part.url] : []
      )
    ).toEqual(
      expect.arrayContaining([
        'https://docs.macro.com/AI/bring-your-own',
        'https://github.com/macro-inc/macro/tree/main/crates/coding_agent_worker',
      ])
    );
  });
});

describe('markdownParts', () => {
  it('finds links between text and keeps every other character', () => {
    expect(
      markdownParts('- [Docs](https://docs.test)\n- [SDK](https://sdk.test)\n')
    ).toEqual([
      { t: 'text', text: '- ' },
      { t: 'link', label: 'Docs', url: 'https://docs.test' },
      { t: 'text', text: '\n- ' },
      { t: 'link', label: 'SDK', url: 'https://sdk.test' },
      { t: 'text', text: '\n' },
    ]);
  });

  it('leaves code that only looks close to a link as text', () => {
    const code = 'const list = [a, b]; call(list);';

    expect(markdownParts(code)).toEqual([{ t: 'text', text: code }]);
  });
});
