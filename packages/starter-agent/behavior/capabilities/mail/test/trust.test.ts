import { describe, expect, test } from 'bun:test';
import { parseMail } from '../message.ts';
import { gate } from '../reply.ts';
import { sha256 } from '../sha256.ts';
import {
  authResults,
  isColleagueAddress,
  isOwnAddress,
  parseAddress,
  senderAuthenticated,
  trustedColleague,
  whoOf,
} from '../trust.ts';
import { fail, mail, noon, type Over, pass, raw, who } from './helpers.ts';

/** A public mail provider, where anyone can have an address. */
const provider = 'gmail.com';

describe('who counts as a colleague', () => {
  test("the owner's domain is read from their Macro id", () => {
    expect(who).toEqual({
      mailbox: 'agent@example.com',
      owner: 'owner@example.com',
      domain: 'example.com',
    });
  });
  test("exactly the owner's domain, nothing that looks like it", () => {
    expect(isColleagueAddress('ada@example.com', who)).toBe(true);
    expect(isColleagueAddress('ADA@EXAMPLE.COM', who)).toBe(true);
    for (const bad of [
      'x@example.com.evil.test',
      'x@sub.example.com',
      'x@notification.example.com',
      // Lookalikes of the owner's domain.
      ...['example.co', 'exarnple.com'].map((domain) => `x@${domain}`),
      'x@example.com.',
      'x@evil.test,y@example.com',
      'x@exаmple.com',
      '"x@example.com"@evil.test',
      'x@example.com@evil.test',
      '<x@example.com> <y@evil.test>',
      '',
    ])
      expect(isColleagueAddress(bad, who)).toBe(false);
  });
  test("never the agent's own mailbox, or one of its plus aliases", () => {
    expect(isColleagueAddress('agent@example.com', who)).toBe(false);
    expect(isColleagueAddress('agent+review@example.com', who)).toBe(false);
    expect(isOwnAddress(`Agent+x@${'Example.com'}`, who)).toBe(true);
    expect(isOwnAddress('agentx@example.com', who)).toBe(false);
    expect(isOwnAddress('agent@example.org', who)).toBe(false);
  });
  test('at a public provider only the owner counts: anyone can have an address there', () => {
    const public_ = whoOf(`my-agent@${provider}`, `macro|bo@${provider}`);
    expect(public_.domain).toBeUndefined();
    expect(isColleagueAddress(`bo@${provider}`, public_)).toBe(true);
    expect(isColleagueAddress(`stranger@${provider}`, public_)).toBe(false);
  });
  test('an owner id without an address makes nobody a colleague', () => {
    const nobody = whoOf('agent@example.com', 'macro|not-an-address');
    expect(nobody.owner).toBeUndefined();
    expect(nobody.domain).toBeUndefined();
    expect(isColleagueAddress('ada@example.com', nobody)).toBe(false);
  });
  test('the display name is not the address', () => {
    expect(parseAddress('"owner@example.com" <evil@evil.test>')?.domain).toBe(
      'evil.test'
    );
    expect(parseAddress('owner@example.com <evil@evil.test>')?.domain).toBe(
      'evil.test'
    );
    expect(parseAddress('a@b.test, c@example.com')).toBeUndefined();
  });
});

describe('spoofed senders', () => {
  test("all of SPF, DKIM by the sender's domain, and DMARC must pass", () => {
    expect(trustedColleague(mail().headers, who).ok).toBe(true);
    const cases: readonly Over[] = [
      { auth: null },
      { auth: fail('example.com') },
      {
        auth: 'mx.google.com; dkim=pass header.i=@evil.test; spf=pass smtp.mailfrom=x@evil.test; dmarc=pass header.from=example.com',
      },
      {
        auth: 'mx.google.com; dkim=pass header.i=@example.com; spf=fail smtp.mailfrom=x@evil.test; dmarc=pass header.from=example.com',
      },
      {
        auth: 'mx.google.com; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=x@example.com; dmarc=fail header.from=example.com',
      },
      {
        auth: 'attacker.example; dkim=pass header.i=@example.com; spf=pass; dmarc=pass header.from=example.com',
      },
      { headers: { From: 'Second <bo@example.com>' } },
    ];
    for (const over of cases)
      expect(trustedColleague(mail(over).headers, who).ok).toBe(false);
  });
  test('a verified sender elsewhere is no colleague', () => {
    expect(
      trustedColleague(mail({ from: 'x@vendor.test' }).headers, who).ok
    ).toBe(false);
  });
  test("a forged Authentication-Results below Google's counts for nothing", () => {
    const message = raw({ auth: fail('example.com') });
    const [stamp, ...rest] = message.payload?.headers ?? [];
    const forged = {
      ...message,
      payload: {
        ...message.payload,
        headers: [
          ...(stamp === undefined ? [] : [stamp]),
          { name: 'Authentication-Results', value: pass('example.com') },
          ...rest,
        ],
      },
    };
    expect(trustedColleague(parseMail(forged, who).headers, who).ok).toBe(
      false
    );
  });
  test('real shapes: bulk mail with an unaligned bounce domain still passes on DMARC and DKIM', () => {
    const { headers } = mail({
      from: 'Bo <bo@example.com>',
      auth: 'mx.google.com; dkim=pass header.i=@example.com header.s=a header.b=b; dkim=pass header.i=@amazonses.com header.s=c header.b=d; spf=pass (google.com: domain of 0100@mail.example.com designates 1.1.1.1 as permitted sender) smtp.mailfrom=0100@mail.example.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.com; dara=neutral header.i=@example.com',
    });
    expect(authResults(headers)?.dkim.length).toBe(2);
    expect(trustedColleague(headers, who).ok).toBe(true);
  });
  test('a failed stamp is no reply, whoever it names', () => {
    expect(
      gate(
        mail({ from: 'owner@example.com', auth: fail('example.com') }),
        { cc: [], bcc: [] },
        [],
        noon,
        who
      ).ok
    ).toBe(false);
  });
});

test('senderAuthenticated reads the exact From domain', () => {
  expect(senderAuthenticated(mail({ from: 'x@vendor.test' }).headers)).toBe(
    true
  );
  expect(
    senderAuthenticated(
      mail({ from: 'x@vendor.test', auth: pass('other.test') }).headers
    )
  ).toBe(false);
});

test("sha256 matches the standard's own examples", () => {
  expect(sha256('')).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  expect(sha256('abc')).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  expect(
    sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')
  ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  // Longer than one block, and not ASCII.
  expect(sha256('é'.repeat(100))).toBe(
    new Bun.CryptoHasher('sha256').update('é'.repeat(100)).digest('hex')
  );
});
