import {
  type Container,
  isContainer,
  type LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroTree,
} from 'loro-crdt';
import type {
  InferType,
  LoroMapSchema,
  LoroTreeSchema,
  SchemaType,
} from '../schema/types';
import {
  assertTree,
  isContainerSchema,
  isListLikeSchema,
  isLoroTreeSchema,
  isRootSchemaType,
} from '../schema/validators';
import { longestIncreasingSubsequence } from './diff';
import { deepEqual, getRootContainerByType } from './utils';

type TreeSchema = LoroTreeSchema<LoroMapSchema<Record<string, SchemaType>>>;

/** Read containers through their schemas: Loro's JSON tree includes native IDs. */
export function readContainer(
  container: Container,
  schema: SchemaType | undefined
): unknown {
  if (container instanceof LoroTree && schema && isLoroTreeSchema(schema)) {
    const visit = (nodes: ReturnType<LoroTree['roots']>): unknown[] =>
      nodes.map((node) => ({
        data: readContainer(node.data, schema.nodeSchema),
        children: visit(node.children() ?? []),
      }));
    const value = visit(container.roots());
    assertTree(schema, value);
    return value;
  }
  if (container instanceof LoroMap && schema?.type === 'loro-map') {
    return Object.fromEntries(
      container.keys().map((key) => {
        const child = container.get(key);
        return [
          key,
          isContainer(child)
            ? readContainer(child, schema.definition[key])
            : child,
        ];
      })
    );
  }
  if (
    (container instanceof LoroList || container instanceof LoroMovableList) &&
    schema &&
    isListLikeSchema(schema)
  ) {
    return container
      .toArray()
      .map((child) =>
        isContainer(child) ? readContainer(child, schema.itemSchema) : child
      );
  }
  return container.toJSON();
}

export function readDocument(doc: LoroDoc, schema: SchemaType | undefined) {
  const state = doc.toJSON();
  if (schema && isRootSchemaType(schema)) {
    for (const [key, field] of Object.entries(schema.definition)) {
      if (isContainerSchema(field) && key in state) {
        const container = getRootContainerByType(
          doc,
          key,
          field.getContainerType()!
        );
        state[key] = readContainer(container, field);
      }
    }
  }
  return state;
}

/** Native creates/moves/deletes, retaining the data map of every surviving ID. */
export function updateTree(
  tree: LoroTree,
  schema: TreeSchema,
  beforeValue: unknown,
  nextValue: unknown,
  updateData: (
    map: LoroMap,
    before: unknown,
    next: unknown,
    schema: SchemaType
  ) => void
) {
  assertTree(schema, beforeValue);
  assertTree(schema, nextValue);
  tree.enableFractionalIndex(0);
  const flatten = (
    nodes: typeof nextValue,
    parent: string | undefined,
    result = new Map<
      string,
      { node: (typeof nodes)[number]; parent: string | undefined }
    >()
  ) => {
    for (const node of nodes) {
      const id = schema.idSelector(node.data);
      result.set(id, { node, parent });
      flatten(node.children, id, result);
    }
    return result;
  };
  const before = flatten(beforeValue, undefined),
    next = flatten(nextValue, undefined);
  const handles = new Map(
    tree.getNodes().map((node) => {
      const data = readContainer(node.data, schema.nodeSchema);
      // Node data has already passed the complete tree validation above.
      const singleton = [{ data, children: [] }];
      assertTree(schema, singleton);
      return [schema.idSelector(singleton[0]!.data), node];
    })
  );
  const reparent = new Set<string>();
  for (const [id, entry] of next) {
    let handle = handles.get(id);
    if (!handle) {
      handle = tree.createNode();
      handles.set(id, handle);
    }
    const old = before.get(id);
    if (!old || old.parent !== entry.parent) reparent.add(id);
    updateData(
      handle.data,
      old?.node.data ?? {},
      entry.node.data,
      schema.nodeSchema
    );
  }
  // Detach first: reversing an ancestor/descendant relationship must not cause
  // a temporary cycle. Extract survivors before deleting an old parent.
  for (const id of reparent) handles.get(id)!.move();
  for (const [id, entry] of next) {
    if (reparent.has(id))
      handles
        .get(id)!
        .move(entry.parent ? handles.get(entry.parent) : undefined);
  }
  for (const [id, entry] of before) {
    if (!next.has(id) && (!entry.parent || next.has(entry.parent)))
      tree.delete(handles.get(id)!.id);
  }
  function order(
    nodes: InferType<TreeSchema>,
    oldNodes: InferType<TreeSchema>,
    parent?: string
  ) {
    const oldIndices = new Map(
      oldNodes.map((node, index) => [schema.idSelector(node.data), index])
    );
    const common = nodes
      .map((node) => schema.idSelector(node.data))
      .filter((id) => oldIndices.has(id) && !reparent.has(id));
    const stable = new Set(
      longestIncreasingSubsequence(common.map((id) => oldIndices.get(id)!)).map(
        (index) => common[index]
      )
    );
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]!,
        id = schema.idSelector(node.data);
      if (!stable.has(id)) {
        const after = nodes[i + 1];
        if (after)
          handles
            .get(id)!
            .moveBefore(handles.get(schema.idSelector(after.data))!);
        else handles.get(id)!.move(parent ? handles.get(parent) : undefined);
      }
      order(node.children, before.get(id)?.node.children ?? [], id);
    }
  }
  if (!deepEqual(beforeValue, nextValue)) order(nextValue, beforeValue);
}
