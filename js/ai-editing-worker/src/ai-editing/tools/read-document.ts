import { tool } from 'ai';
import { z } from 'zod';
import type { Session } from '../ai-toolkit';

export function createReadDocumentTool(serialize: (s: Session) => string, s: Session) {
  return tool({
    description:
      'Read the current document in full. Call this after all edits are done to verify the result matches your intent before giving your final summary.',
    inputSchema: z.object({}),
    execute: async () => serialize(s),
  });
}
