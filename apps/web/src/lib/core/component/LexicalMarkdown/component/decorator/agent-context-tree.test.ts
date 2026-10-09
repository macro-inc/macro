import { describe, expect, it } from 'vitest';
import { parseContext, summaryOf } from './agent-context-tree';

describe('parseContext', () => {
  it('reads elements, attributes, notes and text', () => {
    expect(
      parseContext(
        '<trigger kind="mentioned"><note>Opened the session.</note><channel id="c1" name="eng" type="public"/><thread root="m1"><message id="m1" author="Julia">hello</message></thread></trigger>'
      )
    ).toEqual([
      {
        tag: 'trigger',
        attributes: [['kind', 'mentioned']],
        notes: ['Opened the session.'],
        text: undefined,
        children: [
          {
            tag: 'channel',
            attributes: [
              ['id', 'c1'],
              ['name', 'eng'],
              ['type', 'public'],
            ],
            notes: [],
            text: undefined,
            children: [],
          },
          {
            tag: 'thread',
            attributes: [['root', 'm1']],
            notes: [],
            text: undefined,
            children: [
              {
                tag: 'message',
                attributes: [
                  ['id', 'm1'],
                  ['author', 'Julia'],
                ],
                notes: [],
                text: 'hello',
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('gives up on text that is not XML', () => {
    expect(parseContext('Prior message 1: <unclosed')).toBeUndefined();
  });
});

describe('summaryOf', () => {
  it('names the kind and the channel', () => {
    expect(
      summaryOf(
        parseContext(
          '<session owner="Wolf"/><trigger kind="follow_up"><discussion><channel name="eng"/></discussion></trigger>'
        ) ?? []
      )
    ).toBe('Follow-up · #eng');
  });

  it('names a task by its title', () => {
    expect(
      summaryOf(
        parseContext(
          '<trigger kind="task_assigned"><task id="t1" title="Fix scroll"/></trigger>'
        ) ?? []
      )
    ).toBe('Task assigned · Fix scroll');
  });

  it('falls back to Context without a trigger', () => {
    expect(
      summaryOf(parseContext('<instructions>Be brief.</instructions>') ?? [])
    ).toBe('Context');
  });
});
