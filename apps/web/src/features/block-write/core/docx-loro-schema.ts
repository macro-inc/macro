import { schema } from '@loro-mirror/core';
import { DOCX_LORO_CONTAINERS } from '@macro-inc/collaboration/docx/schema';

const strings = () =>
  schema.LoroMap({} as Record<string, ReturnType<typeof schema.String>>);

/** Mirror schema for the collaborative DOCX roots (see `DOCX_LORO_CONTAINERS`). */
export const DOCX_LORO_SCHEMA = schema({
  [DOCX_LORO_CONTAINERS.meta]: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  [DOCX_LORO_CONTAINERS.blocks]: strings(),
  [DOCX_LORO_CONTAINERS.order]: strings(),
  [DOCX_LORO_CONTAINERS.parts]: strings(),
  [DOCX_LORO_CONTAINERS.marks]: strings(),
});
