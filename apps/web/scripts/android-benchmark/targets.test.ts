import { describe, expect, it } from 'vitest';
import {
  candidates,
  chooseCandidate,
  fingerprint,
  NoCandidateError,
  type Observation,
  parseTargets,
  type TargetItem,
} from './targets';

const A = { name: 'Alpha', id: 'a-id' };
const B = { name: 'Beta', id: 'b-id' };
const C = { name: 'Gamma', id: 'c-id' };

describe('parseTargets', () => {
  it('keeps a file with one channel working unchanged', () => {
    const file = parseTargets(
      JSON.stringify({ channel: A, smallDocument: B, largeDocument: C })
    );
    expect(candidates(file, 'channel')).toEqual([A]);
    expect(candidates(file, 'smallDocument')).toEqual([B]);
    expect(candidates(file, 'largeDocument')).toEqual([C]);
  });

  it('reads an ordered list of channel candidates', () => {
    const file = parseTargets(JSON.stringify({ channels: [B, C] }));
    expect(candidates(file, 'channel')).toEqual([B, C]);
  });

  it('tries channel first when both are set', () => {
    const file = parseTargets(JSON.stringify({ channel: A, channels: [B, C] }));
    expect(candidates(file, 'channel')).toEqual([A, B, C]);
  });

  it('allows missing keys', () => {
    const file = parseTargets('{}');
    expect(candidates(file, 'channel')).toEqual([]);
    expect(candidates(file, 'largeDocument')).toEqual([]);
  });

  it('rejects malformed files, naming the entry', () => {
    expect(() => parseTargets('{')).toThrow(/not JSON/);
    expect(() => parseTargets('[]')).toThrow(/JSON object/);
    expect(() => parseTargets(JSON.stringify({ channel: { name: 'x' } }))).toThrow(
      /channel must be/
    );
    expect(() => parseTargets(JSON.stringify({ channels: [] }))).toThrow(
      /non-empty list/
    );
    expect(() =>
      parseTargets(JSON.stringify({ channels: [A, { name: '', id: 'z' }] }))
    ).toThrow(/channels\[1\]/);
  });
});

describe('fingerprint', () => {
  it('is short, stable, and does not contain the id', () => {
    expect(fingerprint('a-id')).toBe(fingerprint('a-id'));
    expect(fingerprint('a-id')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint('a-id')).not.toBe(fingerprint('b-id'));
    expect(fingerprint('a-id')).not.toContain('a-id');
  });
});

/** Observes each item from a table, recording which ones were looked at. */
function observer(table: Record<string, Observation>) {
  const seen: string[] = [];
  return {
    seen,
    observe: async (item: TargetItem) => {
      seen.push(item.name);
      return table[item.name];
    },
  };
}

describe('chooseCandidate', () => {
  it('uses the first candidate that shows no unread, looking no further', async () => {
    const { seen, observe } = observer({
      Alpha: 'unread',
      Beta: 'quiet',
      Gamma: 'quiet',
    });
    const { choice, skipped } = await chooseCandidate('channel', [A, B, C], observe);
    expect(choice).toEqual({
      key: 'channel',
      index: 1,
      of: 3,
      fingerprint: fingerprint(B.id),
    });
    expect(skipped).toEqual(['channel candidate 0 shows unread']);
    expect(seen).toEqual(['Alpha', 'Beta']);
  });

  it('skips a candidate that is not in the list', async () => {
    const { observe } = observer({ Alpha: 'missing', Beta: 'quiet' });
    const { choice } = await chooseCandidate('channel', [A, B], observe);
    expect(choice.index).toBe(1);
  });

  it('fails, by position and never by name, when none can be opened', async () => {
    const { observe } = observer({ Alpha: 'unread', Beta: 'missing' });
    const failure = chooseCandidate('channel', [A, B], observe);
    await expect(failure).rejects.toThrow(
      'No channel candidate can be opened: channel candidate 0 shows unread; channel candidate 1 is not in the list'
    );
    await expect(failure).rejects.not.toThrow(/Alpha|Beta/);
  });

  it('tells an all-unread moment from a setup error', async () => {
    const unread = await chooseCandidate(
      'channel',
      [A, B],
      observer({ Alpha: 'unread', Beta: 'unread' }).observe
    ).catch((error: unknown) => error);
    expect(unread).toBeInstanceOf(NoCandidateError);
    expect((unread as NoCandidateError).onlyUnread).toBe(true);
    const missing = await chooseCandidate(
      'channel',
      [A, B],
      observer({ Alpha: 'unread', Beta: 'missing' }).observe
    ).catch((error: unknown) => error);
    expect((missing as NoCandidateError).onlyUnread).toBe(false);
  });

  it('asks for the key when there is no candidate', async () => {
    const { observe } = observer({});
    await expect(chooseCandidate('channel', [], observe)).rejects.toThrow(
      'Set channel or channels in the targets file'
    );
    await expect(chooseCandidate('smallDocument', [], observe)).rejects.toThrow(
      'Set smallDocument in the targets file'
    );
  });
});
