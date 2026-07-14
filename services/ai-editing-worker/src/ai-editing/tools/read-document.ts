import { tool } from 'ai';
import { z } from 'zod';
import type { LexicalSession } from '../ai-toolkit';
import { numberLines, serializeWithXml } from '../utils';

/** Escape hatch for a writer whose context window is too narrow: returns the
 *  WHOLE document as line-numbered XML so it can find an id/region it can't see.
 *  Cheaper than handing the problem back to the supervisor — the writer should
 *  reach for this before `reportBlocked`, not instead of doing the edit. */
export function createReadDocumentTool(opts: { session: LexicalSession }) {
  return tool({
    description:
      'Return the ENTIRE document as line-numbered XML. Call this ONLY when the id or region you need is not in your context window and you would otherwise have to reportBlocked.',
    inputSchema: z.object({}),
    execute: async () => numberLines(serializeWithXml(opts.session)),
  });
}
