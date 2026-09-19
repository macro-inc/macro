import { describe, expect, it } from 'vitest';
import { chatComposerTips } from './chat-composer-tip';

describe('Chat composer tips', () => {
  it('covers connectors, skills, mentions and agents for a new conversation', () => {
    const tips = chatComposerTips();
    expect(tips[0]).toContain('Connections');
    expect(tips[1]).toContain('skill');
    expect(tips[2]).toContain('@');
    expect(tips[3]).toContain('agent');
    expect(tips).toHaveLength(4);
  });

  it('omits the agent-selection tip inside a session', () => {
    const tips = chatComposerTips(false);
    expect(tips).toHaveLength(3);
    expect(tips.some((tip) => tip.includes('Choose an agent'))).toBe(false);
    expect(tips[1]).toContain('skill');
    expect(tips[2]).toContain('@');
  });
});
