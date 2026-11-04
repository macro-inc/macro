import {
  type ContainerID,
  isContainer,
  type LoroDoc,
  type LoroEventBatch,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroTree,
} from 'loro-crdt';
import {
  type ContainerSchemaType,
  isContainerSchema,
  isListLikeSchema,
  isLoroMapSchema,
  isLoroTreeSchema,
  type SchemaType,
} from '../schema';

/** Schema lookup for attached containers, including native tree-node data maps. */
export class ContainerRegistry {
  private schemas = new Map<ContainerID, ContainerSchemaType | undefined>();
  constructor(private doc: LoroDoc) {}

  ids() {
    return Array.from(this.schemas.keys());
  }
  get(id: ContainerID) {
    return this.schemas.get(id);
  }
  set(id: ContainerID, schema: ContainerSchemaType | undefined) {
    this.schemas.set(id, schema);
  }

  child(id: ContainerID, key: string | number): SchemaType | undefined {
    const schema = this.get(id);
    if (schema && isLoroMapSchema(schema)) return schema.definition[key];
    if (schema && isListLikeSchema(schema)) return schema.itemSchema;
    return undefined;
  }

  childContainer(
    id: ContainerID,
    key: string | number
  ): ContainerSchemaType | undefined {
    const child = this.child(id, key);
    return isContainerSchema(child) ? child : undefined;
  }

  /** Registers `id` and every container under it. */
  register(id: ContainerID, schema: ContainerSchemaType | undefined) {
    this.walk(id, schema, true);
  }

  /**
   * `walkKnown` false skips children already registered. Native events use it:
   * their new containers have new ids, and a known container's descendants
   * were registered with it or arrive as events of their own.
   */
  private walk(
    id: ContainerID,
    schema: ContainerSchemaType | undefined,
    walkKnown: boolean
  ) {
    const container = this.doc.getContainerById(id);
    if (!container) return;
    this.set(id, schema);
    const walkChild = (
      childId: ContainerID,
      childSchema: ContainerSchemaType | undefined
    ) => {
      if (walkKnown || !this.schemas.has(childId))
        this.walk(childId, childSchema, walkKnown);
    };
    if (container instanceof LoroTree && schema && isLoroTreeSchema(schema)) {
      for (const node of container.getNodes())
        walkChild(node.data.id, schema.nodeSchema);
    } else if (container instanceof LoroMap) {
      for (const key of container.keys()) {
        const value = container.get(key);
        if (isContainer(value))
          walkChild(value.id, this.childContainer(id, key));
      }
    } else if (
      container instanceof LoroList ||
      container instanceof LoroMovableList
    ) {
      const itemSchema =
        schema &&
        isListLikeSchema(schema) &&
        isContainerSchema(schema.itemSchema)
          ? schema.itemSchema
          : undefined;
      for (const value of container.toArray()) {
        if (isContainer(value)) walkChild(value.id, itemSchema);
      }
    }
  }

  onBatch(batch: LoroEventBatch) {
    // Parent registration discovers newly attached descendants regardless of
    // whether their data events precede or follow the parent's event in a batch.
    for (const event of batch.events)
      this.walk(event.target, this.get(event.target), false);
  }
}
