import { type SchemaType, schema } from '../loro-mirror/packages/core/src';

const markdownNodeSchema = schema.LoroMap({
  $: schema.LoroMap({} as any, {
    required: false,
  }),
  text: schema.LoroText({
    required: false,
  }),
  ids: schema.LoroList(schema.String(), (idStr) => idStr, {
    required: false,
  }),
  children: schema.LoroMovableList(
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

export const MARKDOWN_LORO_SCHEMA = schema({
  root: markdownNodeSchema,
});
