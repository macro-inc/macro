import { EntityType } from '@service-properties/generated/schemas/entityType';
import { z } from 'zod';

const propertyValue = z.discriminatedUnion('valueType', [
  z.object({ valueType: z.literal('STRING'), value: z.string().nullable() }),
  z.object({ valueType: z.literal('NUMBER'), value: z.number().nullable() }),
  z.object({ valueType: z.literal('BOOLEAN'), value: z.boolean().nullable() }),
  z.object({
    valueType: z.literal('DATE'),
    value: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .nullable(),
  }),
  z.object({
    valueType: z.literal('SELECT_STRING'),
    values: z.array(z.string()).nullable(),
  }),
  z.object({
    valueType: z.literal('SELECT_NUMBER'),
    values: z.array(z.string()).nullable(),
  }),
  z.object({
    valueType: z.literal('LINK'),
    values: z.array(z.string()).nullable(),
  }),
  z.object({
    valueType: z.literal('ENTITY'),
    refs: z
      .array(
        z.object({
          entity_id: z.string(),
          entity_type: z.enum(EntityType),
          specific_message_id: z.uuid().nullable().optional(),
        })
      )
      .nullable(),
  }),
]);

// Preserve each Lexical node's additional payload. Malformed editor envelopes
// fall back to the saved Markdown instead of making the draft unrecoverable.
const editorState = z.object({
  root: z.looseObject({
    type: z.literal('root'),
    version: z.number(),
    children: z.array(z.looseObject({ type: z.string(), version: z.number() })),
    direction: z.enum(['ltr', 'rtl']).nullable(),
    format: z.enum(['', 'left', 'start', 'center', 'right', 'end', 'justify']),
    indent: z.number(),
  }),
});

export const taskComposerDraftSchema = z.object({
  title: z.string(),
  content: z.string(),
  editorState: editorState.optional().catch(undefined),
  propertyValues: z.record(z.string(), propertyValue),
  visiblePropertyIds: z.array(z.string()).optional(),
});

export const taskSubmissionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  contextKey: z.string().optional(),
  draft: taskComposerDraftSchema,
  shareWithTeam: z.boolean(),
});
