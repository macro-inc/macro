import { z } from 'zod';

/**
 * GoAlert outgoing webhook payloads (`notification/webhook` in GoAlert).
 *
 * Every payload carries `AppName` and a `Type` naming its kind. Schemas are
 * loose and text fields default to empty, because GoAlert omits fields that do
 * not apply and may add new ones.
 */

const text = z.string().default('');

const alertSchema = z.looseObject({
  Type: z.literal('Alert'),
  AlertID: z.number(),
  Summary: text,
  Details: text,
  ServiceID: text,
  ServiceName: text,
  Meta: z.record(z.string(), z.string()).nullish(),
  GoAlertURL: text,
});

const alertStatusSchema = z.looseObject({
  Type: z.literal('AlertStatus'),
  AlertID: z.number(),
  Summary: text,
  ServiceID: text,
  ServiceName: text,
  LogEntry: text,
  GoAlertURL: text,
});

const alertBundleSchema = z.looseObject({
  Type: z.literal('AlertBundle'),
  ServiceID: text,
  ServiceName: text,
  Count: z.number(),
  GoAlertURL: text,
});

const alertStatusBundleSchema = z.looseObject({
  Type: z.literal('AlertStatusBundle'),
  ServiceID: text,
  ServiceName: text,
  LogEntry: text,
  Count: z.number(),
  GoAlertURL: text,
});

const scheduleOnCallUsersSchema = z.looseObject({
  Type: z.literal('ScheduleOnCallUsers'),
  ScheduleName: text,
  ScheduleURL: text,
  Users: z.array(z.looseObject({ Name: text })).default([]),
});

const testSchema = z.looseObject({ Type: z.literal('Test') });

const verificationSchema = z.looseObject({
  Type: z.literal('Verification'),
  Code: z.union([z.string(), z.number()]).optional(),
});

const goAlertPayloadSchema = z.discriminatedUnion('Type', [
  alertSchema,
  alertStatusSchema,
  alertBundleSchema,
  alertStatusBundleSchema,
  scheduleOnCallUsersSchema,
  testSchema,
  verificationSchema,
]);

export type AlertPayload = z.infer<typeof alertSchema>;
export type AlertStatusPayload = z.infer<typeof alertStatusSchema>;
export type GoAlertPayload = z.infer<typeof goAlertPayloadSchema>;

/** Parse a webhook body, or `undefined` for anything this bot does not know. */
export function parseGoAlertPayload(body: unknown): GoAlertPayload | undefined {
  const result = goAlertPayloadSchema.safeParse(body);
  return result.success ? result.data : undefined;
}
