/**
 * The messages between the runner (Bun) and the browser host (Node), one
 * JSON object per line. The host can only do what the fixture needs: open
 * the registered lab URL, report what it observed, capture the quiz, act
 * through the quiz's own controls, and close. There is no message for
 * evaluating script, navigating elsewhere, clicking at coordinates or
 * reaching the browser's protocol.
 */
import { z } from 'zod';

const Observations = z.strictObject({
  mainFrameUrl: z.string().optional(),
  mainNavigations: z.number(),
  redirects: z.number(),
  popups: z.number(),
  extraFrames: z.number(),
  blockedOrigins: z.array(z.string()),
  blockedNavigations: z.number(),
});

export const Action = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('choose'), label: z.string().max(16) }),
  z.strictObject({
    kind: z.literal('order'),
    labels: z.array(z.string().max(16)).max(8),
  }),
  z.strictObject({ kind: z.literal('transcribe'), text: z.string().max(16) }),
]);
export type Action = z.infer<typeof Action>;

export const HostRequest = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('open'),
    targetUrl: z.string(),
    capability: z.string(),
    sessionNonce: z.string(),
    profile: z.string(),
    executablePath: z.string().optional(),
  }),
  z.strictObject({ type: z.literal('observe') }),
  z.strictObject({ type: z.literal('capture') }),
  z.strictObject({ type: z.literal('act'), action: Action }),
  z.strictObject({ type: z.literal('close') }),
]);
export type HostRequest = z.infer<typeof HostRequest>;

export const HostReply = z.union([
  z.strictObject({
    type: z.literal('opened'),
    result: z.enum(['ok', 'launch_failed', 'load_failed']),
    observations: Observations,
  }),
  z.strictObject({
    type: z.literal('observations'),
    observations: Observations,
  }),
  z.strictObject({
    type: z.literal('captured'),
    result: z.literal('ok'),
    prompt: z.string(),
    /** PNG, base64. */
    screenshot: z.string(),
    /** The visible option labels, in page order. */
    labels: z.array(z.string()),
    /** Whether the quiz's own text input and submit button are visible. */
    textControls: z.boolean(),
  }),
  z.strictObject({ type: z.literal('captured'), result: z.literal('failed') }),
  z.strictObject({
    type: z.literal('acted'),
    result: z.enum(['ok', 'no_single_control', 'failed']),
    /** A fixed failure code, never an error message. */
    code: z.string().optional(),
    observations: Observations,
  }),
  z.strictObject({ type: z.literal('closed') }),
]);
export type HostReply = z.infer<typeof HostReply>;
