// The real-mail browser tier has its own provider and receiver. Its UI evidence
// belongs to the named Dovecot journey, independent of the OAuth function matrix.
export const IMAP_CONFIRMATION = {
  source: 'src/lib/core/email-link/index.ts#Inbox reconnected',
  connect: 'Inbox connected',
  reconnect: 'Inbox reconnected',
} as const;

export const IMAP_OPERATIONS = [
  'GET /email/email/links/suggestion',
  'POST /email/email/links/imap/discover',
  'POST /email/email/links/imap',
  'GET /email/email/links/{}/imap/settings',
  'PATCH /email/email/links/{}/imap/settings',
] as const;

export const IMAP_JOURNEY =
  'connects the verified address and replies over SMTP @full-stack';
export const IMAP_EVIDENCE = 'imap-lab-observations';
