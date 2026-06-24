import { tool } from 'ai';
import { z } from 'zod';
import type { SearchDocuments } from '../agents/types';

export function createSearchDocumentsTool(searchDocuments: SearchDocuments) {
  return tool({
    description:
      "Search for documents by name or keyword. Call this before inserting a document-card block, to resolve the document's name to its exact id and blockName.",
    inputSchema: z.object({
      query: z.string().describe('name or keyword to search for'),
    }),
    execute: async ({ query }) => {
      const results = await searchDocuments(query);
      if (results.length === 0) return 'No matches found.';
      return JSON.stringify(results);
    },
  });
}
