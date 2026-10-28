// Persisted version 1 schema, retained only for file format migration.
import { z } from 'zod';
import { isRecord } from './document-format';

// Node Types
const NODE_TYPES = [
  'text',
  'entitymention',
  'link',
  'shape',
  'pencil',
  'image',
  'video',
] as const;

// Sides for edges
const EDGE_SIDES = ['top', 'right', 'bottom', 'left'] as const;

// Edge endpoint styles
const EDGE_END_STYLES: readonly string[] = [
  'none',
  'arrow',
  'arrow-filled',
  'circle',
  'circle-small',
] as const;

const EDGE_CONNECTION_STYLES: readonly string[] = [
  'straight',
  'stepped',
  'smooth',
] as const;

const SHAPES = ['rectangle', 'ellipse'] as const;

const IMAGE_STATUS = ['dss', 'static', 'loading'] as const;

const VIDEO_STATUS = ['dss', 'static', 'loading'] as const;

// Historical files use both numeric enum values and string style names.
const looseNumber = z
  .unknown()
  .optional()
  .transform((value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const end = EDGE_END_STYLES.indexOf(value);
      if (end !== -1) return end;
      const connection = EDGE_CONNECTION_STYLES.indexOf(value);
      if (connection !== -1) return connection;
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  });

const hex = z
  .string()
  .regex(/^#[0-9A-F]{3,6}[0-9a-f]{0,2}$/i, 'Invalid hex color');

const hexColorSchema = z.literal('transparent').or(hex);

/**
 * The bucket of styles that nodes and edges can apply.
 */
const StyleSchema = z.object({
  fillColor: hexColorSchema.optional(),
  strokeColor: hexColorSchema.optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  opacity: z.number().lte(1).gte(0).optional(),
  textSize: z.number().optional(),
  fromEndStyle: looseNumber.optional(),
  toEndStyle: looseNumber.optional(),
  connectionStyle: looseNumber.optional(),
  importedColor: z.boolean().optional(),
});

// Generic node schema with common attributes
const BaseNodeSchema = z.object({
  id: z.string(),
  groupId: z.string().optional(),
  type: z.enum(NODE_TYPES),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  edges: z.string().array().optional().default([]),
  style: StyleSchema.optional(),
  sortOrder: z.number().optional().default(0),
  layer: z.number().optional().default(0),
  label: z.string().optional(),
});

// Text node schema
// followTextWidth is a flag is set to true the very first time we are typing
// into a text node. Once the node loses focus, the pending width is done
// and text box wraps at the width of the node.
const TextNodeSchema = BaseNodeSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  followTextWidth: z.boolean().optional(),
});

// Entity mention node schema with backward compatibility
const EntityMentionSchema = z.preprocess(
  (data) => {
    // migrate old schema to new schema
    if (isRecord(data)) {
      if (data.type === 'file') {
        data.type = 'entitymention';
      }

      if (!data.entityType) {
        if (data.isChat) {
          data.entityType = 'chat';
        } else if (data.isProject) {
          data.entityType = 'project';
        } else {
          data.entityType = 'document';
        }

        // Remove old fields
        delete data.isChat;
        delete data.isRss;
        delete data.isProject;
      }
    }
    return data;
  },
  BaseNodeSchema.extend({
    type: z.literal('entitymention'),
    entityType: z.enum([
      'document',
      'chat',
      'project',
      'channel',
      'email',
      'call',
    ]),
    file: z.string(),
    subpath: z.string().optional(),
    mentionUuid: z.string().optional(),
  })
);

// Link node schema
const LinkNodeSchema = BaseNodeSchema.extend({
  type: z.literal('link'),
  url: z.string().url(),
});

const ShapeNodeSchema = BaseNodeSchema.extend({
  type: z.literal('shape'),
  shape: z.enum(SHAPES).default('rectangle'),
});

const ImageNodeSchema = BaseNodeSchema.extend({
  type: z.literal('image'),
  status: z.enum(IMAGE_STATUS).optional().default('dss'),
  uuid: z.string(),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
});

const VideoNodeSchema = BaseNodeSchema.extend({
  type: z.literal('video'),
  status: z.enum(VIDEO_STATUS).optional().default('dss'),
  uuid: z.string(),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
});

const PencilNodeSchema = BaseNodeSchema.extend({
  type: z.literal('pencil'),
  coords: z.tuple([z.number(), z.number()]).array(),
  wScale: z.number().default(1),
  hScale: z.number().default(1),
});

// Union of all node types
const NodeSchema = z.union([
  TextNodeSchema,
  EntityMentionSchema,
  LinkNodeSchema,
  ShapeNodeSchema,
  ImageNodeSchema,
  VideoNodeSchema,
  PencilNodeSchema,
]);

const ConnectedEnd = z.object({
  type: z.literal('connected'),
  node: z.string(),
  side: z.enum(EDGE_SIDES),
});

const FreeEnd = z.object({
  type: z.literal('free'),
  x: z.number(),
  y: z.number(),
});

const EdgeEnd = z.union([ConnectedEnd, FreeEnd]);

// Edge schema
const EdgeSchema = z.object({
  id: z.string(),
  groupId: z.string().optional(),
  from: EdgeEnd,
  to: EdgeEnd,
  label: z.string().optional(),
  style: StyleSchema.optional(),
  sortOrder: z.number().optional().default(0),
  layer: z.number().optional().default(0),
});

// Group schema
const GroupSchema = z.object({
  id: z.string(),
  childNodes: z.array(z.string()).optional(),
  childEdges: z.array(z.string()).optional(),
  sortOrder: z.number().optional().default(0),
  layer: z.number().optional().default(0),
});

// Top-level canvas schema
export const CanvasSchema = z.object({
  nodes: z.array(NodeSchema).optional(),
  edges: z.array(EdgeSchema).optional(),
  groups: z.array(GroupSchema).optional(),
});

export type Canvas = z.infer<typeof CanvasSchema>;
export type CanvasEntityStyle = z.infer<typeof StyleSchema>;
export type EdgeEnd = z.infer<typeof EdgeEnd>;
