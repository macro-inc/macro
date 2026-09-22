import { z } from 'zod';

const text = z.string().nullish();
export const invitationTimeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), value: z.string() }),
  z.object({
    kind: z.literal('zoned'),
    value: z.string(),
    local: z.string(),
    time_zone: z.string(),
  }),
  z.object({
    kind: z.literal('unresolved'),
    value: z.string(),
    time_zone: text,
  }),
]);
export const invitationParticipantSchema = z.object({
  email: z.string(),
  name: text,
  participation_status: text,
  role: text,
  kind: text,
});
export const invitationSnapshotSchema = z.object({
  id: z.string(),
  uid: z.string(),
  source_part: z.string(),
  attachment_id: text,
  content_hash: z.string(),
  parser_version: z.number(),
  method: z.enum([
    'request',
    'reply',
    'cancel',
    'counter',
    'publish',
    'unknown',
  ]),
  sequence: z.number(),
  dtstamp: text,
  last_modified: text,
  status: text,
  prodid: text,
  recurrence_id: invitationTimeSchema.nullish(),
  recurrence_id_raw: text,
  title: text,
  organizer: invitationParticipantSchema.nullish(),
  attendees: z.array(invitationParticipantSchema),
  comment: text,
  location: text,
  description: text,
  start: invitationTimeSchema.nullish(),
  end: invitationTimeSchema.nullish(),
  duration: text,
  recurrence: z.array(z.string()),
  conference_url: text,
  event_url: text,
  files: z.array(z.string()),
  timezones: z.array(z.string()),
  limitations: z.array(z.string()),
});
export const invitationEnvelopeSchema = z.object({
  status: z.enum(['unprocessed', 'pending', 'ready', 'absent', 'unsupported']),
  invitations: z.array(invitationSnapshotSchema),
});

/** Old caches and unsupported future payloads fall back to the intact ordinary email. */
export function decodeCalendarInvitations(
  input: unknown
): z.infer<typeof invitationEnvelopeSchema> | undefined {
  const result = invitationEnvelopeSchema.safeParse(input);
  return result.success ? result.data : undefined;
}
