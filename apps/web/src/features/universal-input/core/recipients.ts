import * as EmailValidator from 'email-validator';

export type Recipient = {
  id: string;
  label: string;
  email?: string;
  kind: 'user' | 'channel';
};

export function recipientTerms(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** Only exact names, addresses, IDs or a unique first name can resolve automatically. */
export function resolveRecipients(
  text: string,
  options: Recipient[],
  allowExternal: boolean
): { recipients: Recipient[]; unresolved: string[] } {
  return resolveRecipientTerms(recipientTerms(text), options, allowExternal);
}

/** Model-provided lists already have boundaries; do not split names a second time. */
export function resolveRecipientTerms(
  terms: string[],
  options: Recipient[],
  allowExternal: boolean
): { recipients: Recipient[]; unresolved: string[] } {
  const recipients: Recipient[] = [];
  const unresolved: string[] = [];
  for (const term of terms.map((term) => term.trim()).filter(Boolean)) {
    const query = term.toLowerCase().replace(/^[@#]/, '');
    const exact = options.filter((p) =>
      [p.id, p.email, p.label].some((value) => value?.toLowerCase() === query)
    );
    const matches = exact.length
      ? exact
      : options.filter((p) => p.label.toLowerCase().split(/\s+/)[0] === query);
    if (matches.length === 1) recipients.push(matches[0]);
    else if (!matches.length && allowExternal && EmailValidator.validate(term))
      recipients.push({ id: term, email: term, label: term, kind: 'user' });
    else unresolved.push(term);
  }
  return {
    recipients: [...new Map(recipients.map((p) => [p.id, p])).values()],
    unresolved,
  };
}
