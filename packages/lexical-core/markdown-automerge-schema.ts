import { type SchemaType, schema } from '@macro-inc/automerge/mirror';

const markdownNodeSchema = schema.AutomergeMap({
  $: schema.AutomergeMap({} as any, {
    required: false,
  }),
  text: schema.AutomergeText({
    required: false,
  }),
  ids: schema.AutomergeList(schema.String(), (idStr) => idStr, {
    required: false,
  }),
  children: schema.AutomergeMovableList(
    {} as SchemaType,
    (item) => {
      const id = item?.$?.id;
      if (!id) {
        console.error('no id for item', item);
      }
      return id;
    },
    {
      required: false,
    }
  ),
});

markdownNodeSchema.definition.children.itemSchema = markdownNodeSchema;

export const MARKDOWN_AUTOMERGE_SCHEMA = schema({
  root: markdownNodeSchema,
});

export type MarkdownAutomergeSchemaType = typeof MARKDOWN_AUTOMERGE_SCHEMA;
