import { ARTIFACT_HTML_MAX_LENGTH } from '@macro-inc/graphics';
import { ARTIFACT_LIBRARY_ENTRY_MAX_LENGTH } from '@macro-inc/graphics/loro';
import { z } from 'zod';

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const size = z.number().positive().max(100_000);
const id = z.string().min(1).max(200);
const ids = z
  .array(id)
  .min(1)
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Item IDs must be unique.'
  );
const text = z.string().max(10_000);
export const canvasUserMentionSchema = z
  .object({
    userId: z.string().min(1).max(512),
    email: z.string().email().max(320),
    displayName: z.string().min(1).max(200).optional(),
  })
  .strict();
export const textFitMode = z.enum(['grow', 'contain', 'error']);
export type TextFitMode = z.infer<typeof textFitMode>;
const color = z
  .string()
  .regex(
    /^(#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})|transparent|none)$/
  );
const style = z
  .object({
    fill: color.optional(),
    stroke: color.optional(),
    strokeWidth: z.number().min(0).max(100).optional(),
    opacity: z.number().min(0).max(1).optional(),
    cornerRadius: z.number().min(0).max(10000).optional(),
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  })
  .strict();
const endpoint = z
  .object({
    point: z.object({ x: coordinate, y: coordinate }).strict(),
    binding: z
      .object({
        targetId: id,
        anchor: z.enum(['center', 'top', 'right', 'bottom', 'left']),
      })
      .strict()
      .optional(),
  })
  .strict();

const artifactHtml = z.string().max(ARTIFACT_HTML_MAX_LENGTH);
const artifactTitle = z.string().max(200);
const designSize = z.number().positive().max(10_000);
const libraryName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const librarySource = z.string().max(ARTIFACT_LIBRARY_ENTRY_MAX_LENGTH);

export const canvasOpSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      id,
      type: z.enum(['rectangle', 'ellipse', 'text']),
      x: coordinate,
      y: coordinate,
      width: size.optional(),
      height: size.optional(),
      text: text.optional(),
      fontSize: z.number().min(1).max(1000).optional(),
      fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
      fitText: textFitMode.optional(),
      style: style.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('connect'),
      id,
      start: endpoint,
      end: endpoint,
      route: z.enum(['straight', 'stepped', 'smooth']),
      text: text.optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('move'), ids, dx: coordinate, dy: coordinate })
    .strict(),
  z
    .object({
      kind: z.literal('resize'),
      id,
      width: size,
      height: size,
      fitText: textFitMode.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('style'), ids, style }).strict(),
  z
    .object({
      kind: z.literal('mentionUser'),
      id,
      at: z.number().int().min(0).max(100_000),
      person: canvasUserMentionSchema,
      fitText: textFitMode.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('text'),
      id,
      text,
      fitText: textFitMode.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('fitText'),
      id,
      mode: textFitMode,
      width: size.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('textStyle'),
      id,
      fontSize: z.number().min(1).max(1000).optional(),
      fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
      fitText: textFitMode.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('delete'), ids }).strict(),
  z.object({ kind: z.literal('group'), ids, id }).strict(),
  z.object({ kind: z.literal('ungroup'), id }).strict(),
  z.object({ kind: z.literal('reparent'), id, parentId: id }).strict(),
  z
    .object({
      kind: z.literal('order'),
      ids,
      position: z.enum(['front', 'back', 'forward', 'backward']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('createArtifact'),
      id,
      x: coordinate,
      y: coordinate,
      title: artifactTitle,
      html: artifactHtml,
      width: size.optional(),
      height: size.optional(),
      designWidth: designSize.optional(),
      designHeight: designSize.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifactSource'),
      id,
      title: artifactTitle.optional(),
      html: artifactHtml.optional(),
      designWidth: designSize.optional(),
      designHeight: designSize.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifactEdit'),
      id,
      find: artifactHtml.min(1),
      replace: artifactHtml,
    })
    .strict(),
  z
    .object({
      kind: z.literal('defineStyle'),
      name: libraryName,
      css: librarySource.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('defineComponent'),
      name: libraryName,
      html: librarySource.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('presentOrder'), ids }).strict(),
]);
export const canvasOpsSchema = z.array(canvasOpSchema).max(100);
export type CanvasOp = z.infer<typeof canvasOpSchema>;

/** Operations that need the artifacts rollout. Generic ones such as move also
 * work on an existing artifact, so that every client can tidy a shared canvas. */
const ARTIFACT_OPS: ReadonlySet<CanvasOp['kind']> = new Set([
  'createArtifact',
  'artifactSource',
  'artifactEdit',
  'defineStyle',
  'defineComponent',
  'presentOrder',
]);
export const isArtifactOp = (op: CanvasOp) => ARTIFACT_OPS.has(op.kind);
