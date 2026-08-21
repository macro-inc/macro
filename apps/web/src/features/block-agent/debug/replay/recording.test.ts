import { describe, expect, it } from 'vitest';
import { isPromptEntry, parseRecording } from './recording';

const LINE = (object: unknown) => JSON.stringify(object);

describe('parseRecording', () => {
  it('re-keys recorder ts to createdAt and keeps the envelope verbatim', () => {
    const entries = parseRecording(
      [
        LINE({
          ts: '2026-08-03T21:04:19.934Z',
          direction: 'to_server',
          content: { type: 'event', event: 'acp_ready' },
        }),
        '',
        LINE({
          ts: '2026-08-03T21:04:20.000Z',
          direction: 'to_runtime',
          content: { type: 'acp', jsonrpc: '2.0', method: 'session/prompt' },
        }),
      ].join('\n')
    );

    expect(entries).toEqual([
      {
        createdAt: '2026-08-03T21:04:19.934Z',
        direction: 'to_server',
        content: { type: 'event', event: 'acp_ready' },
      },
      {
        createdAt: '2026-08-03T21:04:20.000Z',
        direction: 'to_runtime',
        content: { type: 'acp', jsonrpc: '2.0', method: 'session/prompt' },
      },
    ]);
  });

  it('prefers an explicit createdAt and keeps userId when attributed', () => {
    const [entry] = parseRecording(
      LINE({
        ts: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-02-02T00:00:00.000Z',
        userId: 'macro|someone@example.com',
        direction: 'to_server',
        content: { type: 'event', event: 'acp_ready' },
      })
    );

    expect(entry).toMatchObject({
      createdAt: '2026-02-02T00:00:00.000Z',
      userId: 'macro|someone@example.com',
    });
  });

  it.each([
    ['not JSON', 'nope', /line 1 is not JSON/],
    [
      'a missing direction',
      LINE({ ts: 't', content: {} }),
      /line 1 has no direction/,
    ],
    [
      'a missing envelope',
      LINE({ ts: 't', direction: 'to_server' }),
      /line 1 has no content envelope/,
    ],
  ])('throws with the line number on %s', (_name, line, message) => {
    expect(() => parseRecording(line)).toThrow(message);
  });
});

describe('isPromptEntry', () => {
  it('matches only session/prompt frames headed to the runtime', () => {
    const prompt = {
      createdAt: 't',
      direction: 'to_runtime',
      content: { type: 'acp', method: 'session/prompt' },
    } as const;
    expect(isPromptEntry(prompt)).toBe(true);
    expect(isPromptEntry({ ...prompt, direction: 'to_server' })).toBe(false);
    expect(
      isPromptEntry({
        ...prompt,
        content: { type: 'acp', method: 'session/update' },
      })
    ).toBe(false);
  });
});
