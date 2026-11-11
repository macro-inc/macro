/**
 * A Gmail API message, and the fields the rest of this area reads from it.
 * Pure.
 */
import { z } from 'zod';
import { links } from './redact.ts';
import { sha256 } from './sha256.ts';
import {
  type Address,
  automated,
  claimsColleague,
  Header,
  header,
  isOwnAddress,
  parseAddress,
  senderAuthenticated,
  trustedColleague,
  type Who,
} from './trust.ts';

export type RawPart = {
  readonly mimeType?: string | undefined;
  readonly filename?: string | undefined;
  readonly headers?: readonly Header[] | undefined;
  readonly body?: { readonly data?: string | undefined } | undefined;
  readonly parts?: readonly RawPart[] | undefined;
};

export const RawPart: z.ZodType<RawPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(Header).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(RawPart).optional(),
  })
);

/** A message as Gmail's API returns it with `format=full`. */
export const RawMail = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  internalDate: z.string().optional(),
  snippet: z.string().optional(),
  payload: RawPart.optional(),
});
export type RawMail = z.infer<typeof RawMail>;

export type Mail = {
  readonly id: string;
  readonly threadId: string;
  readonly labels: readonly string[];
  /** When Gmail received it, ISO 8601. */
  readonly at: string;
  readonly headers: readonly Header[];
  readonly subject: string;
  readonly text: string;
  /** The sender, or undefined when From isn't one plain address. */
  readonly from: Address | undefined;
  readonly own: boolean;
  /** DMARC passed for the exact domain in From. */
  readonly authenticated: boolean;
  /** A verified colleague (see `trustedColleague`), and why or why not. */
  readonly colleague: boolean;
  readonly colleagueWhy: string;
  /** From claims a colleague's domain or the owner's address, verified or not. */
  readonly claimsColleague: boolean;
  /** The display name shows the owner's or the agent's address, and From is another. */
  readonly posing: boolean;
  /** Why it counts as automated (an auto-reply, a no-reply address, a list), if it does. */
  readonly automated: string | undefined;
};

/** Gmail's base64url, as text. */
const decode = (data: string): string => {
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0)
      )
    );
  } catch {
    // Not base64 at all: a part that can't be read is an empty one.
    return '';
  }
};

const walk = (part: RawPart | undefined): readonly RawPart[] =>
  part === undefined ? [] : [part, ...(part.parts ?? []).flatMap(walk)];

export const stripHtml = (html: string): string =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, ' $1 ')
    .replace(/<(br|p|div|tr|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');

/** The mail's text: its plain part, or its HTML part stripped. Attachments are never read. */
export const bodyText = (payload: RawPart | undefined): string => {
  const texts = walk(payload).flatMap(({ filename, body, mimeType }) =>
    (filename === undefined || filename === '') &&
    body?.data !== undefined &&
    body.data !== ''
      ? [{ mimeType, data: body.data }]
      : []
  );
  const plain = texts.find(({ mimeType }) => mimeType === 'text/plain');
  if (plain !== undefined) return decode(plain.data);
  const html = texts.find(({ mimeType }) => mimeType === 'text/html');
  return html === undefined ? '' : stripHtml(decode(html.data));
};

const receivedAt = (internalDate: string | undefined): string => {
  const milliseconds = Number(internalDate ?? 0);
  return Temporal.Instant.fromEpochMilliseconds(
    Number.isSafeInteger(milliseconds) ? milliseconds : 0
  ).toString();
};

const posingAs = (from: Address | undefined, who: Who): boolean =>
  from !== undefined &&
  [who.owner, who.mailbox].some(
    (address) =>
      address !== undefined &&
      address !== '' &&
      address !== from.address &&
      from.display.toLowerCase().includes(address)
  );

/** A mail as the rest of this area reads it, for this agent and its owner. */
export const parseMail = (raw: RawMail, who: Who): Mail => {
  const headers = raw.payload?.headers ?? [];
  const from = parseAddress(header(headers, 'From'));
  const colleague = trustedColleague(headers, who);
  return {
    id: raw.id,
    threadId: raw.threadId,
    labels: raw.labelIds ?? [],
    at: receivedAt(raw.internalDate),
    headers,
    subject: header(headers, 'Subject') ?? '',
    text: bodyText(raw.payload),
    from,
    own: from !== undefined && isOwnAddress(from.address, who),
    authenticated: senderAuthenticated(headers),
    colleague: colleague.ok,
    colleagueWhy: colleague.why,
    claimsColleague: from !== undefined && claimsColleague(from, who),
    posing: posingAs(from, who),
    automated: automated(headers),
  };
};

/** The sender's domain, for a log, a note or a prompt. It is checked to be a plain domain. */
export const domainOf = (mail: Pick<Mail, 'from'>): string =>
  mail.from?.domain ?? 'unreadable';

const keyLength = 32;

/** A link without query or fragment, hashed: enough to spot it again, useless to anyone reading the store. */
export const linkKey = (url: string): string | undefined => {
  if (!URL.canParse(url)) return undefined;
  const { host, pathname } = new URL(url);
  // A vendor's front door isn't a link from the mail.
  if (pathname === '/' || pathname === '') return undefined;
  return sha256(`${host.toLowerCase()}${pathname.replace(/\/+$/, '')}`).slice(
    0,
    keyLength
  );
};

export const linksIn = (text: string): readonly string[] =>
  [...text.matchAll(links)].map(([url]) => url);

export const linkKeys = (text: string): readonly string[] => [
  ...new Set(
    linksIn(text).flatMap((url) => {
      const key = linkKey(url);
      return key === undefined ? [] : [key];
    })
  ),
];
