import { ENABLE_CANVAS_VIDEO } from '@core/constant/featureFlags';
import { z } from 'zod';

// For now we are just using strings as node ids.
// But it's nice to habe a names type for clode clarity
export type CanvasId = string;

// TODO: The fact that edge style are defined but not used is causing
// a lot of the ai-gen parse fails. Move a to loose number. This is a
// hack until we either migrate to Loro or a Zod schema v2.
const looseNumber = z
  .any()
  .optional()
  .transform((v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && EDGE_END_STYLES.includes(v as any))
      return EDGE_END_STYLES.indexOf(v as any);
    if (typeof v === 'string' && EDGE_CONNECTION_STYLES.includes(v as any))
      return EDGE_CONNECTION_STYLES.indexOf(v as any);
    const parsedNumber = Number(v);
    if (Number.isNaN(parsedNumber)) return 0;
    return parsedNumber;
  });

// Node Types
export const NODE_TYPES = [
  'text',
  'file',
  'link',
  'shape',
  'pencil',
  'image',
  'video',
] as const;
export const NodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = (typeof NODE_TYPES)[number];

// Sides for edges
export const EDGE_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export const EdgeSideSchema = z.enum(EDGE_SIDES);
export type EdgeSideType = (typeof EDGE_SIDES)[number];
export const EdgeSides = {
  Top: 0,
  Right: 1,
  Bottom: 2,
  Left: 3,
};

// Edge endpoint styles
const EDGE_END_STYLES = [
  'none',
  'arrow',
  'arrow-filled',
  'circle',
  'circle-small',
] as const;
export const EdgeEndStyleSchema = z.enum(EDGE_END_STYLES);
export type EdgeEndStyle = (typeof EDGE_END_STYLES)[number];
export const EdgeEndStyles = {
  None: 0,
  Arrow: 1,
  ArrowFilled: 2,
  Circle: 3,
  CircleSmall: 4,
} as const;

export const EDGE_CONNECTION_STYLES = [
  'straight',
  'stepped',
  'smooth',
] as const;
export const EdgeConnectionStyleSchema = z.enum(EDGE_CONNECTION_STYLES);
export type EdgeConnectionStyle = (typeof EDGE_CONNECTION_STYLES)[number];
export const EdgeConnectionStyles = {
  straight: 0,
  stepped: 1,
  smooth: 2,
} as const;

const SHAPES = ['rectangle', 'ellipse'] as const;
export const ShapeSchema = z.enum(SHAPES);
export type ShapeType = (typeof SHAPES)[number];

const IMAGE_STATUS = ['dss', 'static', 'loading'] as const;
export const ImageStatusSchema = z.enum(IMAGE_STATUS);
export type ImageSourcesType = (typeof IMAGE_STATUS)[number];

const VIDEO_STATUS = ['dss', 'static', 'loading'] as const;
export const VideoStatusSchema = z.enum(VIDEO_STATUS);
export type VideoSourcesType = (typeof VIDEO_STATUS)[number];

const hex = z
  .string()
  .regex(/^#[0-9A-F]{3,6}[0-9a-f]{0,2}$/i, 'Invalid hex color');

const hexColorSchema = z.literal('transparent').or(hex);

/**
 * The bucket of styles that nodes and edges can apply.
 */
export const StyleSchema = z.object({
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

export type CanvasEntityStyle = z.infer<typeof StyleSchema>;

// Generic node schema with common attributes
export const BaseNodeSchema = z.object({
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
export const TextNodeSchema = BaseNodeSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  followTextWidth: z.boolean().optional(),
});

// File node schema
export const FileNodeSchema = BaseNodeSchema.extend({
  type: z.literal('file'),
  isChat: z.boolean().optional(),
  isRss: z.boolean().optional(),
  isProject: z.boolean().optional(),
  file: z.string(),
  subpath: z.string().optional(),
  mentionUuid: z.string().optional(),
});

// Link node schema
export const LinkNodeSchema = BaseNodeSchema.extend({
  type: z.literal('link'),
  url: z.string().url(),
});

export const ShapeNodeSchema = BaseNodeSchema.extend({
  type: z.literal('shape'),
  shape: z.enum(SHAPES).default('rectangle'),
});

export const ImageNodeSchema = BaseNodeSchema.extend({
  type: z.literal('image'),
  status: z.enum(IMAGE_STATUS).optional().default('dss'),
  uuid: z.string(),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
});

export const VideoNodeSchema = BaseNodeSchema.extend({
  type: z.literal('video'),
  status: z.enum(VIDEO_STATUS).optional().default('dss'),
  uuid: z.string(),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
});

export const PencilNodeSchema = BaseNodeSchema.extend({
  type: z.literal('pencil'),
  coords: z.tuple([z.number(), z.number()]).array(),
  wScale: z.number().default(1),
  hScale: z.number().default(1),
});

// Union of all node types
export const NodeSchema = z.union([
  TextNodeSchema,
  FileNodeSchema,
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
export type ConnectedEnd = z.infer<typeof ConnectedEnd>;

const FreeEnd = z.object({
  type: z.literal('free'),
  x: z.number(),
  y: z.number(),
});
export type FreeEnd = z.infer<typeof FreeEnd>;

const EdgeEnd = z.union([ConnectedEnd, FreeEnd]);
export type EdgeEnd = z.infer<typeof EdgeEnd>;

// Edge schema
export const EdgeSchema = z.object({
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
export const GroupSchema = z.object({
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

// Inferred Schemas Types
export type BaseNode = z.infer<typeof BaseNodeSchema>;
export type TextNode = z.infer<typeof TextNodeSchema>;
export type FileNode = z.infer<typeof FileNodeSchema>;
export type LinkNode = z.infer<typeof LinkNodeSchema>;
export type ShapeNode = z.infer<typeof ShapeNodeSchema>;
export type ImageNode = z.infer<typeof ImageNodeSchema>;
export type VideoNode = z.infer<typeof VideoNodeSchema>;
export type PencilNode = z.infer<typeof PencilNodeSchema>;
export type CanvasNode =
  | BaseNode
  | TextNode
  | FileNode
  | LinkNode
  | ShapeNode
  | ImageNode
  | VideoNode
  | PencilNode;
export type CanvasEdge = z.infer<typeof EdgeSchema>;
export type CanvasGroup = z.infer<typeof GroupSchema>;
export type Canvas = z.infer<typeof CanvasSchema>;

export type CanvasEntity = CanvasNode | CanvasEdge | CanvasGroup;

export const isCanvasNode = (entity: CanvasEntity): entity is CanvasNode => {
  return 'type' in entity;
};

export const isCanvasEdge = (entity: CanvasEntity): entity is CanvasEdge => {
  return 'to' in entity;
};

export const isTextNode = (node: CanvasNode): node is TextNode => {
  return node.type === 'text';
};

export const isFileNode = (node: CanvasNode): node is FileNode => {
  return node.type === 'file';
};

export const isLinkNode = (node: CanvasNode): node is LinkNode => {
  return node.type === 'link';
};

export const isShapeNode = (node: CanvasNode): node is ShapeNode => {
  return node.type === 'shape';
};

export const isImageNode = (node: CanvasNode): node is ImageNode => {
  return node.type === 'image';
};

export const isVideoNode = (node: CanvasNode): node is VideoNode => {
  return ENABLE_CANVAS_VIDEO && node.type === 'video';
};

export const isPencilNode = (node: CanvasNode): node is PencilNode => {
  return node.type === 'pencil';
};
