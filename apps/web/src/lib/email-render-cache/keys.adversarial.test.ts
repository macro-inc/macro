/**
 * Key framing: distinct inputs must never share an artifact key component.
 */
import { prepareEmailBody } from '@macro-inc/email-renderer';
import { describe, expect, it } from 'vitest';
import { digest, policyTuple, sameSource, sourceTuple } from './keys';

describe('key framing', () => {
  it('source and policy tuples stay injective for awkward strings (holds)', async () => {
    const awkward = [
      '',
      '\uD800',
      '\uDBFF',
      '�',
      '"],["',
      '\\"',
      'null',
      '\u0000',
    ];
    const tuples = new Set<string>();
    const hashes = new Set<string>();
    let count = 0;
    for (const html of [...awkward, null, undefined])
      for (const text of [...awkward, null]) {
        const input = { html, text };
        count++;
        tuples.add(sourceTuple(input));
        hashes.add(await digest(sourceTuple(input)));
      }
    // null and undefined intentionally frame the same (sameSource agrees).
    const expected = count - (awkward.length + 1);
    expect(tuples.size).toBe(expected);
    expect(hashes.size).toBe(expected);
    expect(sameSource({ html: undefined }, { html: null })).toBe(true);
    // Equal policy tuples must mean equal preparation.
    const input = {
      html: '<p>a<img src="https://x/y.png"></p><div class="macro_quote">q</div>',
    };
    const options = [
      {},
      { images: { remote: 'allow' as const } },
      { showQuotedContent: false, showFullContent: false },
    ];
    for (const value of options)
      expect(policyTuple(value)).toBe(policyTuple({}));
    for (const value of options)
      expect(prepareEmailBody(input, value)).toEqual(prepareEmailBody(input));
  });

  it('framed mailbox identity hashing does not merge distinct mailbox ids', async () => {
    // TextEncoder maps every lone surrogate to U+FFFD, so raw digests of these
    // ids collide. service.ts frames the mailbox id with JSON.stringify, which
    // escapes lone surrogates. (Production ids are server UUIDs.)
    const ids = ['inbox\uD800', 'inbox\uDBFF', 'inbox�'];
    const hashes = new Set(
      await Promise.all(ids.map((id) => digest(JSON.stringify([id]))))
    );
    expect(hashes.size).toBe(ids.length);
  });
});
