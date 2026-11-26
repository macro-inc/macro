// What the providers hold, read the way their own clients read it: for
// assertions about a sent message's headers and body that the emulators'
// summaries leave out.

import type { Provider, StackInfo } from './stack';

async function gmailToken(stack: StackInfo, email: string): Promise<string> {
  const response = await fetch(
    `${stack.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(email)}/access-tokens`,
    { method: 'POST' }
  );
  if (!response.ok) throw new Error(`no Gmail token: ${response.status}`);
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

/** A Gmail message as RFC 822 text: headers, a blank line, the MIME body. */
export async function gmailRawMessage(
  stack: StackInfo,
  email: string,
  id: string
): Promise<string> {
  const token = await gmailToken(stack, email);
  const response = await fetch(
    `${stack.gmailUrl}/gmail/v1/users/me/messages/${id}?format=raw`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!response.ok)
    throw new Error(`no Gmail message ${id}: ${response.status}`);
  const body = (await response.json()) as { raw: string };
  return Buffer.from(body.raw, 'base64url').toString('utf8');
}

/** A header of an RFC 822 message, unfolded; `undefined` when absent. */
export function header(raw: string, name: string): string | undefined {
  const head = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, ' ');
  const line = head
    .split(/\r?\n/)
    .find((candidate) =>
      candidate.toLowerCase().startsWith(`${name.toLowerCase()}:`)
    );
  return line?.slice(name.length + 1).trim();
}

async function outlookToken(stack: StackInfo, email: string): Promise<string> {
  const response = await fetch(
    `${stack.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(email)}/access-tokens`,
    { method: 'POST' }
  );
  if (!response.ok) throw new Error(`no Outlook token: ${response.status}`);
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

/**
 * An Outlook message as RFC 822 text, as Graph's `$value` answers it. Graph
 * leaves out `Bcc`, as Exchange does for a received message.
 */
export async function outlookRawMessage(
  stack: StackInfo,
  email: string,
  id: string
): Promise<string> {
  const token = await outlookToken(stack, email);
  const response = await fetch(
    `${stack.outlookUrl}/v1.0/users/${encodeURIComponent(email)}/messages/${id}/$value`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!response.ok)
    throw new Error(`no Outlook message ${id}: ${response.status}`);
  return response.text();
}

/** A message of either provider as RFC 822 text. */
export function rawMessage(
  stack: StackInfo,
  provider: Provider,
  email: string,
  id: string
): Promise<string> {
  return provider === 'GMAIL'
    ? gmailRawMessage(stack, email, id)
    : outlookRawMessage(stack, email, id);
}
