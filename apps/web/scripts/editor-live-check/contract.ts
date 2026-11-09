import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

export const installSteps = [
  'existing-document',
  'new-document',
  'type',
  'undo-redo',
  'sign-in',
  'all-common-blocks-persist-reopen',
] as const;

const nodeSchema = z
  .object({
    type: z.string(),
    children: z.array(z.unknown()).optional(),
    $: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const stateSchema = z.object({ root: nodeSchema });

export function documentFacts(input: unknown) {
  const state = stateSchema.parse(input);
  const nodes: z.infer<typeof nodeSchema>[] = [];
  function visit(value: unknown) {
    const node = nodeSchema.parse(value);
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  visit(state.root);
  const required = new Map<string, boolean>([
    ['heading', false],
    ['list', false],
    ['checklist', false],
    ['code', false],
    ['table', false],
    ['quote', false],
    ['link', false],
    ['mention', false],
    ['equation', false],
    ['image', false],
    ['comment', false],
  ]);
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === 'heading') required.set('heading', true);
    if (['list', 'task-list'].includes(node.type)) {
      if (node.listType === 'check') required.set('checklist', true);
      else required.set('list', true);
    }
    if (node.type === 'custom-code') required.set('code', true);
    if (node.type === 'table') required.set('table', true);
    if (node.type === 'quote') required.set('quote', true);
    if (node.type === 'link') required.set('link', true);
    if (node.type === 'user-mention') required.set('mention', true);
    if (node.type === 'equation') required.set('equation', true);
    if (node.type === 'image') required.set('image', true);
    if (node.type === 'comment-mark') required.set('comment', true);
    const id = node.$?.id;
    if (typeof id !== 'string' || id.length === 0)
      throw new Error(`Missing durable ID on ${node.type}`);
    ids.push(id);
  }
  const missing = [...required]
    .filter(([, found]) => !found)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(`Missing required common blocks: ${missing.join(', ')}`);
  if (new Set(ids).size !== ids.length)
    throw new Error('Duplicate durable IDs');
  return { state, ids, types: nodes.map((node) => node.type) };
}

export function assertReopened(
  before: { json: unknown; dom: unknown },
  after: { json: unknown; dom: unknown }
) {
  const first = documentFacts(before.json);
  const second = documentFacts(after.json);
  if (!isDeepStrictEqual(before.json, after.json))
    throw new Error('Reopened full JSON differs');
  if (!isDeepStrictEqual(first.ids, second.ids))
    throw new Error('Reopened durable IDs differ');
  if (!isDeepStrictEqual(before.dom, after.dom))
    throw new Error('Reopened DOM differs');
}
