import { schema } from '@loro-mirror/core';
import { DOCX_LORO_CONTAINERS } from './docx-loro';

/**
 * Schema handed to the sync stack's Loro manager. The DOCX editor reads and
 * writes the Loro document directly (see `docx-loro.ts`) and turns the
 * manager's JSON mirror off, so only the format metadata is declared.
 */
export const DOCX_LORO_SCHEMA = schema({
  [DOCX_LORO_CONTAINERS.meta]: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
});
