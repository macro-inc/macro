import { z } from 'zod';
import { DATABASE_COLORS } from '../core/database';
import { FIELD_KINDS, SIGNATURE_STYLES } from '../core/packet';

const adoptedSignature = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('typed'),
    text: z.string(),
    style: z.enum(SIGNATURE_STYLES),
  }),
  z.object({ kind: z.literal('drawn'), dataUrl: z.string() }),
  z.object({ kind: z.literal('image'), dataUrl: z.string() }),
]);

const recipient = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['signer', 'copy']),
  isSender: z.boolean(),
  access: z
    .object({ token: z.string(), tokenId: z.string(), issuedAt: z.string() })
    .optional(),
  viewedAt: z.string().optional(),
  disclosureAcceptedAt: z.string().optional(),
  signedAt: z.string().optional(),
  declinedAt: z.string().optional(),
  declineReason: z.string().optional(),
  signature: adoptedSignature.optional(),
  initials: adoptedSignature.optional(),
  userAgent: z.string().optional(),
});

const field = z.object({
  id: z.string(),
  documentId: z.string(),
  page: z.number().int().min(0),
  recipientId: z.string(),
  kind: z.enum(FIELD_KINDS),
  required: z.boolean(),
  box: z.object({
    xPct: z.number(),
    yPct: z.number(),
    widthPct: z.number(),
    heightPct: z.number(),
  }),
  value: z.union([z.string(), z.boolean()]).optional(),
});

const event = z.object({
  id: z.string(),
  type: z.enum([
    'contract.created',
    'contract.sent',
    'contract.viewed',
    'contract.signed_by_recipient',
    'contract.completed',
    'contract.declined',
    'contract.voided',
    'contract.expired',
    'audit.disclosure_accepted',
    'audit.reminder_sent',
    'audit.documents_replaced',
    'audit.status_overridden',
  ]),
  at: z.string(),
  actor: z.string(),
  recipientId: z.string().optional(),
  note: z.string().optional(),
  stateHash: z.string().optional(),
  hash: z.string().optional(),
});

const packet = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.object({ id: z.string(), name: z.string() }),
  documents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pageCount: z.number().int().min(1),
      source: z.enum(['drive', 'upload']),
      convertedFrom: z.literal('docx').optional(),
      sha256: z.string(),
    })
  ),
  recipients: z.array(recipient),
  fields: z.array(field),
  signingOrder: z.enum(['parallel', 'sequential']),
  databaseIds: z.array(z.string()).min(1),
  company: z.string().optional(),
  expirationDays: z.number().int().min(1),
  reminderDays: z.number().int().min(1).nullable(),
  createdAt: z.string(),
  sentAt: z.string().optional(),
  expiresAt: z.string().optional(),
  completedAt: z.string().optional(),
  expiredAt: z.string().optional(),
  voidedAt: z.string().optional(),
  voidReason: z.string().optional(),
  lastReminderAt: z.string().optional(),
  statusOverride: z
    .object({
      status: z.literal('signed'),
      tag: z.literal('offline'),
      by: z.string(),
      at: z.string(),
    })
    .optional(),
  events: z.array(event),
});

/** Everything the browser-local Contracts store keeps. */
export const contractsSnapshotSchema = z.object({
  databases: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.enum(DATABASE_COLORS),
    })
  ),
  packets: z.array(packet),
});

export type ContractsSnapshot = z.infer<typeof contractsSnapshotSchema>;
