import { tool } from 'ai';
import { z } from 'zod';
import type { SearchContacts } from '../agents/supervisor';

export function createSearchContactsTool(searchContacts: SearchContacts) {
  return tool({
    description:
      "Search for users and contacts by name. Call this before dispatching any edit that inserts an @mention, to resolve a person's name to their exact id and email.",
    inputSchema: z.object({
      query: z.string().describe('name or partial name to search for'),
    }),
    execute: async ({ query }) => {
      const results = await searchContacts(query);
      if (results.length === 0) return 'No matches found.';
      return JSON.stringify(results);
    },
  });
}
