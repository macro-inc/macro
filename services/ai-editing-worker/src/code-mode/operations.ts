import { z } from 'zod';
import type { DocumentOp, MentionSpec, NodeSpec } from '../ai-editing/editor';

const text = z.string().max(65_536);
const id = z.string().min(1).max(128);
const index = z.number().int().min(0).max(10_000);
const scope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('nth'), n: index.min(1) }),
]);
const format = z.enum(['bold', 'italic', 'underline', 'strike', 'code']);
const list = z.enum(['bullet', 'number', 'check']);
const position = z.union([
  z.strictObject({ after: id }),
  z.strictObject({ before: id }),
  z.strictObject({ appendToRoot: z.literal(true) }),
  z.strictObject({ prependToRoot: z.literal(true) }),
]);
const documentFields = {
  documentId: id,
  documentName: text,
  blockName: text,
  blockParams: z.record(z.string(), text).optional(),
};
const mention: z.ZodType<MentionSpec> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: id, email: text }),
  z.strictObject({
    kind: z.literal('contact'),
    contactId: id,
    name: text,
    emailOrDomain: text,
    isCompany: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('group'), groupAlias: text }),
  z.strictObject({ kind: z.literal('document'), ...documentFields }),
  z.strictObject({
    kind: z.literal('agent_session'),
    id,
    label: text.optional(),
    expanded: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('pr'), id, label: text.optional() }),
  z.strictObject({
    kind: z.literal('tag'),
    optionId: id,
    propertyDefinitionId: id,
    scope: z.enum(['user', 'team']),
    name: text,
    color: text.optional(),
  }),
]);
const node = z.union([
  z.strictObject({ block: z.literal('paragraph'), text: text.optional() }),
  z.strictObject({
    block: z.literal('heading'),
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    text: text.optional(),
  }),
  z.strictObject({ block: z.literal('quote'), text: text.optional() }),
  z.strictObject({
    block: z.literal('code'),
    language: text,
    text: text.optional(),
  }),
  z.strictObject({
    block: z.literal('list'),
    list,
    items: z.array(text).max(200),
  }),
  z.strictObject({
    block: z.literal('table'),
    rows: z.array(z.array(text).max(50)).max(100),
  }),
  z.strictObject({ block: z.literal('divider') }),
  z.strictObject({ block: z.literal('document-card'), ...documentFields }),
  z.strictObject({ block: z.literal('html-render'), html: text }),
  z.strictObject({
    block: z.literal('image'),
    srcType: text,
    url: text,
    alt: text.optional(),
    width: index.optional(),
    height: index.optional(),
  }),
  z.strictObject({
    block: z.literal('video'),
    srcType: text,
    url: text,
    controls: z.boolean().optional(),
    width: index.optional(),
    height: index.optional(),
  }),
  z.strictObject({
    block: z.literal('equation'),
    tex: text,
    inline: z.boolean().optional(),
  }),
  z.strictObject({ inline: z.literal('linebreak') }),
  z.strictObject({ inline: z.literal('equation'), tex: text }),
  z.strictObject({
    inline: z.literal('date'),
    date: text,
    displayFormat: text.optional(),
  }),
  z.strictObject({ inline: z.literal('mention'), mention }),
]) as z.ZodType<NodeSpec>;

// This is an untrusted network boundary: TypeScript casts never validate ops.
export const operationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('insertText'), node: id, at: index, text }),
  z.strictObject({
    kind: z.literal('removeText'),
    node: id,
    at: index,
    len: index,
  }),
  z.strictObject({
    kind: z.literal('appendListItem'),
    ref: id,
    node: id,
    text,
    checked: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('prependListItem'),
    ref: id,
    node: id,
    text,
    checked: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('setText'), node: id, text }),
  z.strictObject({ kind: z.literal('setEquation'), node: id, tex: text }),
  z.strictObject({ kind: z.literal('appendText'), node: id, text }),
  z.strictObject({ kind: z.literal('prependText'), node: id, text }),
  z.strictObject({
    kind: z.literal('insertTextAfterInline'),
    inline: id,
    text,
    ref: id.optional(),
  }),
  z.strictObject({
    kind: z.literal('replaceText'),
    node: id,
    find: text.min(1),
    to: text,
    scope,
  }),
  z.strictObject({
    kind: z.literal('formatText'),
    node: id,
    match: text.min(1),
    format,
    on: z.boolean(),
    scope,
  }),
  z.strictObject({
    kind: z.literal('clearFormat'),
    node: id,
    match: text.min(1).optional(),
    scope,
  }),
  z.strictObject({
    kind: z.literal('markText'),
    node: id,
    match: text.min(1),
    on: z.boolean(),
    scope,
  }),
  z.strictObject({
    kind: z.literal('linkText'),
    node: id,
    match: text.min(1),
    url: text.nullable(),
    scope,
  }),
  z.strictObject({
    kind: z.literal('formatNode'),
    node: id,
    format,
    on: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('clearNodeFormat'), node: id }),
  z.strictObject({
    kind: z.literal('setBlockType'),
    node: id,
    block: z.enum(['paragraph', 'heading', 'quote', 'code']),
    level: index.min(1).max(6).optional(),
    language: text.optional(),
  }),
  z.strictObject({
    kind: z.literal('setListType'),
    nodes: z.array(id).min(1).max(200),
    list,
  }),
  z.strictObject({
    kind: z.literal('setChecked'),
    node: id,
    checked: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('setIndent'),
    node: id,
    indent: z.union([index.max(20), z.literal('in'), z.literal('out')]),
  }),
  z.strictObject({
    kind: z.literal('insertNode'),
    ref: id,
    spec: node,
    at: position,
  }),
  z.strictObject({
    kind: z.literal('insertInline'),
    ref: id,
    node: id,
    at: index,
    spec: node,
  }),
  z.strictObject({ kind: z.literal('moveNode'), node: id, at: position }),
  z.strictObject({ kind: z.literal('removeNode'), node: id }),
  z.strictObject({
    kind: z.literal('mergeBlocks'),
    nodes: z.array(id).min(2).max(200),
    separator: text,
  }),
  z.strictObject({
    kind: z.literal('insertListItemAfter'),
    ref: id,
    node: id,
    text,
    list,
  }),
  z.strictObject({
    kind: z.literal('insertListItemBefore'),
    ref: id,
    node: id,
    text,
    list,
  }),
  z.strictObject({ kind: z.literal('removeListItem'), node: id }),
  z.strictObject({
    kind: z.literal('setCell'),
    table: id,
    row: index,
    col: index,
    text,
  }),
  z.strictObject({
    kind: z.literal('addRow'),
    table: id,
    at: index.optional(),
  }),
  z.strictObject({
    kind: z.literal('addColumn'),
    table: id,
    at: index.optional(),
  }),
  z.strictObject({ kind: z.literal('removeRow'), table: id, row: index }),
  z.strictObject({ kind: z.literal('removeColumn'), table: id, col: index }),
  z.strictObject({ kind: z.literal('setImageAlt'), node: id, alt: text }),
  z.strictObject({ kind: z.literal('setImageUrl'), node: id, url: text }),
  z.strictObject({ kind: z.literal('setVideoUrl'), node: id, url: text }),
  z.strictObject({
    kind: z.literal('setVideoControls'),
    node: id,
    controls: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('setDate'),
    node: id,
    date: text,
    displayFormat: text.optional(),
  }),
]) as z.ZodType<DocumentOp>;

export const documentRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('read') }),
  z.strictObject({
    action: z.literal('edit'),
    expectedRevision: z.string().min(1).max(32_768),
    operations: z.array(operationSchema).min(1).max(200),
  }),
]);
