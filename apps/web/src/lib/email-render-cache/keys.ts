import type { BodyOptions, EmailBodyInput } from '@macro-inc/email-renderer';

export function sourceTuple(input: EmailBodyInput): string {
  return JSON.stringify([
    input.html ?? null,
    input.replylessHtml ?? null,
    input.text ?? null,
  ]);
}

export function policyTuple(options: BodyOptions): string {
  return JSON.stringify([
    options.showQuotedContent ?? false,
    options.showFullContent ?? false,
    options.images?.remote ?? 'allow',
    options.images?.proxyUrl ?? null,
  ]);
}

export function sameSource(a: EmailBodyInput, b: EmailBodyInput): boolean {
  return (
    (a.html ?? null) === (b.html ?? null) &&
    (a.replylessHtml ?? null) === (b.replylessHtml ?? null) &&
    (a.text ?? null) === (b.text ?? null)
  );
}

export function sourceBytes(input: EmailBodyInput): number {
  return (
    2 *
    ((input.html?.length ?? 0) +
      (input.replylessHtml?.length ?? 0) +
      (input.text?.length ?? 0))
  );
}

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
