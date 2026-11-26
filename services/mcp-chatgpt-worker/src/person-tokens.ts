/**
 * Person tokens: what ChatGPT sees in place of a Macro user id or an email
 * address. OpenAI's review rejects a tool that returns personal identifiers
 * the request didn't need, yet ChatGPT still has to name people back to us
 * (assign a task, mention someone, filter by owner). So every
 * `macro|<email>` and every email in a result becomes an opaque token, and a
 * token anywhere in a call's arguments turns back into exactly what it
 * replaced before the call runs. `people_read` is the one way to see who a
 * token is.
 *
 * Stateless: a token is the address encrypted with AES-GCM under a key from
 * the `PERSON_TOKEN_KEY` secret, with the viewer's user id as associated
 * data, so it opens only for the user it was shown to. The IV is an HMAC of
 * viewer and address, so one person is one token across calls (a synthetic
 * IV: equal IVs only ever encrypt equal plaintexts).
 */

import { Buffer } from 'node:buffer';
import { replaceAll } from './replace-all';

/** `macro|` user id prefix, kept in the token's form rather than its body. */
const USER_ID_PREFIX = 'macro|';

const EMAIL = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`;

/** A user id or a bare email, anywhere in a string. */
const IDENTIFIER = new RegExp(`(macro\\|)?(${EMAIL})`, 'g');

/** A person token, anywhere in a string: `person_u_` for a user id, `person_e_` for an email. */
const TOKEN = /\bperson_([ue])_([A-Za-z0-9_-]{38,})/g;

const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class PersonTokenError extends Error {
  constructor(readonly token: string) {
    super(
      `${token.slice(0, 16)}… is not a person token this server gave you; use one from a recent result.`
    );
    this.name = 'PersonTokenError';
  }
}

/** Base64url (unpadded) of `bytes`, by the runtime's Buffer (nodejs_compat). */
const toBase64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64url');

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(text, 'base64url'));

/** The secret's bytes: base64, at least 32 bytes. */
export function keyBytes(secret: string): Uint8Array<ArrayBuffer> | undefined {
  const bytes = new Uint8Array(Buffer.from(secret.trim(), 'base64'));
  return bytes.length >= 32 ? bytes : undefined;
}

type Keys = { encrypt: CryptoKey; iv: CryptoKey };

async function deriveKeys(secret: Uint8Array<ArrayBuffer>): Promise<Keys> {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, [
    'deriveKey',
  ]);
  const derive = (
    info: string,
    algorithm: AesKeyGenParams | HmacImportParams,
    usages: KeyUsage[]
  ) =>
    crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: encoder.encode(info),
      },
      base,
      algorithm,
      false,
      usages
    );
  const [encrypt, iv] = await Promise.all([
    derive('person-token:encrypt', { name: 'AES-GCM', length: 256 }, [
      'encrypt',
      'decrypt',
    ]),
    derive('person-token:iv', { name: 'HMAC', hash: 'SHA-256' }, ['sign']),
  ]);
  return { encrypt, iv };
}

/** Seals and opens person tokens for one viewer. */
export type PersonTokens = {
  /** Every user id and email in `value` (strings, keys, nested) as a token. */
  conceal(value: unknown): Promise<unknown>;
  /** Every token in `value` back to what it replaced; a bad one throws {@link PersonTokenError}. */
  reveal(value: unknown): Promise<unknown>;
  /** The user id or email a token stands for; a bad one throws {@link PersonTokenError}. */
  open(token: string): Promise<string>;
};

/**
 * A key for person tokens. `viewer` names the user they're issued to; it's
 * asked for only when a value holds something to seal or open.
 */
export function personTokenKey(secret: Uint8Array<ArrayBuffer>) {
  const keys = deriveKeys(secret);

  return function forViewer(viewer: () => Promise<string>): PersonTokens {
    let viewerId: Promise<string> | undefined;
    const who = () => {
      viewerId ??= viewer();
      return viewerId;
    };

    async function seal(email: string): Promise<string> {
      const { encrypt, iv } = await keys;
      const id = await who();
      const mac = await crypto.subtle.sign(
        'HMAC',
        iv,
        encoder.encode(`${id}\0${email}`)
      );
      const nonce = new Uint8Array(mac.slice(0, IV_BYTES));
      const sealed = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(id) },
        encrypt,
        encoder.encode(email)
      );
      const bytes = new Uint8Array(IV_BYTES + sealed.byteLength);
      bytes.set(nonce);
      bytes.set(new Uint8Array(sealed), IV_BYTES);
      return toBase64Url(bytes);
    }

    async function openBody(token: string, body: string): Promise<string> {
      const { encrypt } = await keys;
      const id = await who();
      try {
        const bytes = fromBase64Url(body);
        const plain = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: bytes.slice(0, IV_BYTES),
            additionalData: encoder.encode(id),
          },
          encrypt,
          bytes.slice(IV_BYTES)
        );
        return decoder.decode(plain);
      } catch {
        throw new PersonTokenError(token);
      }
    }

    async function open(token: string): Promise<string> {
      const match = new RegExp(`^${TOKEN.source}$`).exec(token.trim());
      if (!match?.[1] || !match[2]) throw new PersonTokenError(token);
      const email = await openBody(token, match[2]);
      return match[1] === 'u' ? `${USER_ID_PREFIX}${email}` : email;
    }

    const sealed = new Map<string, Promise<string>>();
    const concealText = (text: string) =>
      replaceAll(text, IDENTIFIER, async ([, prefix, email = '']) => {
        let body = sealed.get(email);
        if (!body) {
          body = seal(email);
          sealed.set(email, body);
        }
        return `person_${prefix ? 'u' : 'e'}_${await body}`;
      });
    const revealText = (text: string) =>
      replaceAll(text, TOKEN, ([token]) => open(token));

    async function walk(
      value: unknown,
      text: (s: string) => Promise<string>
    ): Promise<unknown> {
      if (typeof value === 'string') return text(value);
      if (Array.isArray(value))
        return Promise.all(value.map((item) => walk(item, text)));
      if (typeof value !== 'object' || value === null) return value;
      const entries = await Promise.all(
        Object.entries(value).map(
          async ([key, item]) =>
            [await text(key), await walk(item, text)] as const
        )
      );
      return Object.fromEntries(entries);
    }

    return {
      conceal: (value) => walk(value, concealText),
      reveal: (value) => walk(value, revealText),
      open,
    };
  };
}

/** Whether `text` holds a user id or email {@link PersonTokens.conceal} would replace. */
export function hasPersonalIdentifier(text: string): boolean {
  return new RegExp(IDENTIFIER.source).test(text);
}
