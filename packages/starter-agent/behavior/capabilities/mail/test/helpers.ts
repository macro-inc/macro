/** Fake mail and stubs only: nothing in these tests touches a network or the agent's real state. */
import type { Disk } from '../../../context/disk.ts';
import type { Acting } from '../act.ts';
import type { Mailbox } from '../gmail.ts';
import { type Mail, parseMail, type RawMail } from '../message.ts';
import { store as makeStore, type Store } from '../store.ts';
import { parseAddress, whoOf } from '../trust.ts';

/** A disk in memory. Paths are keys; a directory is whatever shares a prefix. */
export const memoryDisk = (): Disk & {
  readonly files: Map<string, string>;
} => {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path) => files.get(path),
    write: async (path, text) => {
      files.set(path, text);
    },
    append: async (path, text) => {
      files.set(path, `${files.get(path) ?? ''}${text}`);
    },
    remove: async (path) => {
      for (const name of [...files.keys()])
        if (name === path || name.startsWith(`${path}/`)) files.delete(name);
    },
    rename: async (from, to) => {
      const text = files.get(from);
      if (text === undefined) return false;
      files.delete(from);
      files.set(to, text);
      return true;
    },
    list: async (directory) =>
      [
        ...new Set(
          [...files.keys()]
            .filter((name) => name.startsWith(`${directory}/`))
            .map((name) => name.slice(directory.length + 1).split('/')[0])
            .flatMap((name) => (name === undefined ? [] : [name]))
        ),
      ].sort(),
    exists: async (path) => files.has(path),
    modified: async () => undefined,
    makeDirectory: async () => undefined,
  };
};

export const join = (...parts: readonly string[]): string => parts.join('/');

export const directories = {
  private: 'private',
  run: 'run',
  memory: 'memory',
} as const;

export const testStore = (disk: Disk = memoryDisk()): Store =>
  makeStore({ directories, join, disk });

/** Google's stamp on a mail that passed everything for a domain. */
export const pass = (domain: string): string =>
  `mx.google.com; dkim=pass header.i=@${domain} header.s=s1 header.b=abc; spf=pass (google.com: domain of x@${domain} designates 1.2.3.4 as permitted sender) smtp.mailfrom=x@${domain}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`;
export const fail = (domain: string): string =>
  `mx.google.com; dkim=fail header.i=@${domain}; spf=softfail smtp.mailfrom=y@elsewhere.example; dmarc=fail (p=NONE) header.from=${domain}`;

export type Over = {
  readonly id?: string;
  readonly from?: string;
  /** Google's stamp; null for none; by default a pass for the sender's domain. */
  readonly auth?: string | null;
  readonly subject?: string;
  readonly text?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly labels?: readonly string[];
};

export const base64url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const fromBase64 = (data: string): string =>
  new TextDecoder().decode(
    Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
  );

/** The agent's mailbox is agent@example.com, and its owner is owner@example.com: everyone at example.com is a colleague. */
export const who = whoOf('agent@example.com', 'macro|owner@example.com');

export const raw = (over: Over = {}): RawMail => {
  const from = over.from ?? 'Ada <ada@example.com>';
  const domain = parseAddress(from)?.domain ?? 'example.com';
  const auth = over.auth === undefined ? pass(domain) : over.auth;
  const id = over.id ?? 'm1';
  return {
    id,
    threadId: `t-${id}`,
    labelIds: [...(over.labels ?? ['INBOX'])],
    internalDate: '1793000000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        ...(auth === null
          ? []
          : [{ name: 'Authentication-Results', value: auth }]),
        { name: 'From', value: from },
        { name: 'Subject', value: over.subject ?? 'hello' },
        { name: 'Message-ID', value: '<abc@example.com>' },
        ...Object.entries(over.headers ?? {}).map(([name, value]) => ({
          name,
          value,
        })),
      ],
      body: {
        data: base64url(over.text ?? 'Can you look at the report?'),
      },
    },
  };
};

export const mail = (over: Over = {}): Mail => parseMail(raw(over), who);

export const instant = (text: string): Temporal.Instant =>
  Temporal.Instant.from(text);

export const noon = instant('2026-11-05T12:00:00Z');

export type FakeBox = Omit<Mailbox, 'get' | 'send'> & {
  /** Replaceable, so a test can make Gmail fail. */
  get: Mailbox['get'];
  send: Mailbox['send'];
  /** The mailbox's messages, which a test changes between passes. */
  messages: RawMail[];
  /** Gmail has forgotten the position, once. */
  expired: boolean;
  readonly sent: { readonly raw: string; readonly threadId: string }[];
};

export const fakeBox = (messages: readonly RawMail[] = []): FakeBox => {
  const box: FakeBox = {
    messages: [...messages],
    expired: false,
    sent: [],
    position: async () => '100',
    since: async () => {
      if (box.expired) {
        box.expired = false;
        return { kind: 'expired' };
      }
      return {
        kind: 'ok',
        ids: box.messages.map(({ id }) => id),
        position: '100',
      };
    },
    search: async () => box.messages.map(({ id }) => id),
    get: async (id) => box.messages.find((message) => message.id === id),
    send: async (sent, threadId) => {
      box.sent.push({ raw: sent, threadId });
      return { id: 'sent-1' };
    },
  };
  return box;
};

export const places = { asks: 'shared/asks.md', notes: 'shared/notes.md' };

export type Acted = {
  readonly dms: string[];
  readonly wakes: string[];
  readonly logged: object[];
  /** The notes, as one text. */
  readonly notes: () => string;
  readonly store: Store;
  readonly acting: (now?: Temporal.Instant) => Acting;
};

/** Everything `act` touches, recorded. */
export const acted = (disk: Disk = memoryDisk()): Acted => {
  const dms: string[] = [];
  const wakes: string[] = [];
  const logged: object[] = [];
  const notes: string[] = [];
  const store = testStore(disk);
  return {
    dms,
    wakes,
    logged,
    notes: () => notes.join(''),
    store,
    acting: (now = noon) => ({
      store,
      note: async (line) => {
        notes.push(line);
      },
      dmOwner: async (text) => {
        dms.push(text);
      },
      startWake: async (request) => {
        wakes.push(request);
      },
      log: async (entry) => {
        logged.push(entry);
      },
      now: () => now,
      places,
    }),
  };
};
