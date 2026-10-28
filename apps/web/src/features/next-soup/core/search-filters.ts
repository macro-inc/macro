import { z } from 'zod';

export const searchTypeSchema = z.enum([
  'all',
  'channels',
  'document-or-file',
  'task',
  'email',
  'calls',
  'folders',
  'agent',
  'calendar',
]);
export type SearchTypeValue = z.infer<typeof searchTypeSchema>;
export type SearchIndexId = Exclude<SearchTypeValue, 'all'>;

const channelScope = z.object({
  in: z.array(z.string()),
  from: z.array(z.string()),
});

/** Shared vocabulary for editable global-search facets, including embedded search. */
export const searchFiltersSchema = z.object({
  type: searchTypeSchema.default('all'),
  email: z
    .object({
      importance: z.boolean().optional(),
      inboxIds: z.array(z.string()).optional(),
    })
    .default({}),
  channels: channelScope.default({ in: [], from: [] }),
  calls: channelScope
    .extend({
      status: z.enum(['ATTENDED', 'MISSED', 'UNATTENDED']).optional(),
    })
    .default({ in: [], from: [] }),
  task: z
    .object({
      status: z.array(z.string()),
      priority: z.array(z.string()),
      assignees: z.array(z.string()),
      createdBy: z.array(z.string()),
    })
    .default({ status: [], priority: [], assignees: [], createdBy: [] }),
  tags: z
    .array(
      z.object({
        propertyId: z.string(),
        type: z.enum(['select', 'entity']),
        value: z.string(),
      })
    )
    .default([]),
  tagMode: z.enum(['any', 'all']).default('any'),
});
export type SearchFiltersState = z.infer<typeof searchFiltersSchema>;
export type SearchFiltersSections = Pick<
  SearchFiltersState,
  'email' | 'channels' | 'calls' | 'task'
>;

export const DEFAULT_SECTIONS: SearchFiltersSections = {
  email: {},
  channels: { in: [], from: [] },
  calls: { in: [], from: [] },
  task: { status: [], priority: [], assignees: [], createdBy: [] },
};

export function parseSearchFilters(value: string): SearchFiltersState {
  try {
    const result = searchFiltersSchema.safeParse(JSON.parse(value));
    if (result.success) return result.data;
  } catch {
    /* Empty drafts have no stored filters. */
  }
  return searchFiltersSchema.parse({});
}

/** Channel-list browsing cannot enforce message-level sender constraints. */
export function searchNeedsKeywords(
  state: SearchFiltersState,
  query: string
): boolean {
  return (
    query.trim().length < 3 &&
    ((state.type === 'channels' && state.channels.from.length > 0) ||
      (state.type === 'calls' && state.calls.from.length > 0))
  );
}
