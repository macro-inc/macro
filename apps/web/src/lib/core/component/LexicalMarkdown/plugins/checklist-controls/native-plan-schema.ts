import { z } from 'zod';

const uint32 = z.number().int().min(0).max(0xffff_ffff);
const key = z.object({ index: uint32, generation: uint32 }).strict();
const revision = z
  .string()
  .refine(
    (value) =>
      /^[1-9][0-9]{0,19}$/.test(value) &&
      BigInt(value) <= 0xffff_ffff_ffff_ffffn,
    'Expected a positive u64 revision'
  );
const maybeString = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('missing') }).strict(),
  z.object({ kind: z.literal('null') }).strict(),
  z.object({ kind: z.literal('value'), value: z.string() }).strict(),
]);
const assignee = z.object({ id: maybeString, name: z.string() }).strict();
const item = z
  .object({ key, taskId: maybeString, assignees: z.array(assignee) })
  .strict();
const row = z.object({ key, dimmed: z.boolean() }).strict();
const settings = z
  .object({
    filters: z
      .object({
        status: z.array(z.string()),
        priority: z.array(z.string()),
        assignees: z.array(z.string()),
        due: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
const progress = z
  .object({
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    ratio: z.number().finite(),
    percentage: z.number().finite(),
  })
  .strict();
export const nativeChecklistPresentation = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('planned'),
      settings,
      active: z.boolean(),
      filterCount: z.number().int().nonnegative(),
      hasTasks: z.boolean(),
      progress,
      items: z.array(item),
      rows: z.array(row),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unsupportedInput'),
      field: z.string(),
      settingsContext: z.unknown().refine((value) => value !== undefined),
    })
    .strict(),
  z
    .object({
      kind: z.literal('invalidCalendarFacts'),
      problem: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
const rowChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('remove'), key }).strict(),
  z
    .object({
      kind: z.literal('place'),
      key,
      after: key.nullable(),
      dimmed: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('dim'), key, dimmed: z.boolean() }).strict(),
]);
const itemChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('remove'), key }).strict(),
  z.object({ kind: z.literal('place'), after: key.nullable(), item }).strict(),
  z.object({ kind: z.literal('update'), item }).strict(),
]);
const patch = z
  .object({
    settings: settings.optional(),
    active: z.boolean().optional(),
    filterCount: z.number().int().nonnegative().optional(),
    hasTasks: z.boolean().optional(),
    progress: progress.optional(),
    rows: z.array(rowChange).optional(),
    items: z.array(itemChange).optional(),
  })
  .strict();
const listUpdate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('remove'), listKey: key }).strict(),
  z
    .object({
      kind: z.literal('replace'),
      listKey: key,
      result: nativeChecklistPresentation,
    })
    .strict(),
  z.object({ kind: z.literal('patch'), listKey: key, changes: patch }).strict(),
]);
/** Exact JSON emitted by the typed native ChecklistPlans effect; no defaults. */
export const nativeChecklistDelivery = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('cleared'),
      generation: uint32,
      sequence: revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal('delta'),
      generation: uint32,
      factsVersion: revision,
      sequence: revision,
      reset: z.boolean(),
      lists: z.array(listUpdate),
    })
    .strict(),
]);
export type NativeChecklistDelivery = z.infer<typeof nativeChecklistDelivery>;
export type NativeChecklistPresentation = z.infer<
  typeof nativeChecklistPresentation
>;
export type NativeChecklistBar = Extract<
  NativeChecklistPresentation,
  { kind: 'planned' }
>;
export type NativeChecklistKey = z.infer<typeof key>;
