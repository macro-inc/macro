import { describe, expect, it } from 'vitest';
import { agentInstructionsPreview } from './instructions-preview';

describe('agentInstructionsPreview', () => {
  it('shows the content of formatted instructions and links', () => {
    expect(
      agentInstructionsPreview(
        '# Research\n\n**Cite sources** using [the guide](https://example.com).\n\n- Be precise.'
      )
    ).toBe('Research Cite sources using the guide. Be precise.');
  });

  it('reads older Macro link markup without exposing its payload', () => {
    expect(
      agentInstructionsPreview(
        'Read <m-link>{"url":"https://example.com","text":"the guide","title":""}</m-link>.'
      )
    ).toBe('Read the guide.');
  });

  it('leaves an empty preview empty', () => {
    expect(agentInstructionsPreview('  \n')).toBe('');
  });
});
