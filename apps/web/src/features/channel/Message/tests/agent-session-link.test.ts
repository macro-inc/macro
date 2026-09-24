import { describe, expect, it } from 'vitest';
import { splitLeadingAgentSessionLink } from '../agent-session-link';

const SESSION = '00000000-0000-0000-0000-00000000000a';
// What the agent harness emits: see `session_link` in
// crates/agent_harness/src/outbound/channel_announcer.rs.
const link = `<m-agent-session-mention>{"id":"${SESSION}","label":"Agent session"}</m-agent-session-mention>`;

describe('splitLeadingAgentSessionLink', () => {
  it('lifts the harness session node off the front and keeps the body', () => {
    expect(splitLeadingAgentSessionLink(`${link}\n\nHere you go.`)).toEqual({
      link: { sessionId: SESSION },
      body: 'Here you go.',
    });
  });

  it('lifts it off the pending spinner too', () => {
    const spinner = '<m-await>{"text":"Thinking…","inline":true}</m-await>';
    expect(splitLeadingAgentSessionLink(`${link}\n\n${spinner}`)).toEqual({
      link: { sessionId: SESSION },
      body: spinner,
    });
  });

  it('leaves a session mention that is not leading in the body', () => {
    const content = `See ${link} for details.`;
    expect(splitLeadingAgentSessionLink(content)).toEqual({
      link: undefined,
      body: content,
    });
  });

  it('treats a malformed node as body', () => {
    for (const content of [
      '<m-agent-session-mention>not json</m-agent-session-mention>\n\nbody',
      '<m-agent-session-mention>{"label":"x"}</m-agent-session-mention>\n\nbody',
    ]) {
      expect(splitLeadingAgentSessionLink(content)).toEqual({
        link: undefined,
        body: content,
      });
    }
  });

  it('returns plain content untouched', () => {
    expect(splitLeadingAgentSessionLink('hello')).toEqual({
      link: undefined,
      body: 'hello',
    });
  });
});
