import type { MessagePart } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { documentFromAgentProse } from './document-from-message';

const text = (value: string): MessagePart => ({ kind: 'text', text: value });
const thought = (value: string): MessagePart => ({
  kind: 'thought',
  text: value,
});
const tool = (): MessagePart => ({
  kind: 'tool_use',
  id: 'call',
  name: { kind: 'native', name: 'Read' },
  status: 'completed',
  detail: { kind: 'read', paths: ['notes.md'] },
});

describe('documentFromAgentProse', () => {
  it('saves the reply prose under its first heading', () => {
    const document = documentFromAgentProse([
      text('Let me draft that.'),
      thought('Check the existing roles first.'),
      tool(),
      text(
        '# Filmmaker and Editor\n\nA joint role covering shooting and editing.'
      ),
    ]);

    expect(document).toEqual({
      title: 'Filmmaker and Editor',
      markdown:
        'Let me draft that.\n\n# Filmmaker and Editor\n\nA joint role covering shooting and editing.',
    });
  });

  it('titles an unheaded reply from its first readable line', () => {
    const document = documentFromAgentProse([
      text(
        '1. **Links** to your portfolio, [Vimeo](https://vimeo.com/example), or social presence.'
      ),
    ]);

    expect(document?.title).toBe(
      'Links to your portfolio, Vimeo, or social presence.'
    );
  });

  it('drops a trailing unclosed mention and ignores fenced headings', () => {
    const document = documentFromAgentProse([
      text(
        'Here is the plan.\n\n```md\n# Not the title\n```\n\nSee <m-document-mention>{"documentId":"unfinished'
      ),
    ]);

    expect(document).toEqual({
      title: 'Here is the plan.',
      markdown: 'Here is the plan.\n\n```md\n# Not the title\n```\n\nSee',
    });
  });

  it('returns nothing when the reply has no prose', () => {
    expect(documentFromAgentProse([thought('hmm'), tool()])).toBeUndefined();
    expect(documentFromAgentProse([text('   ')])).toBeUndefined();
  });
});
