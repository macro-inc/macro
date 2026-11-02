import type { SearchSuggestions } from '@service-agent-harness/generated/schemas/searchSuggestions';
import { match, P } from 'ts-pattern';
import {
  type SearchFiltersState,
  searchFiltersSchema,
} from '../../next-soup/core/search-filters';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '../../next-soup/core/search-options';

export type SearchExtraction = SearchSuggestions;

// Tags and tag mode stay in keyword text until tag extraction is supported.
// Every other shared filter, including optional fields, requires a wire mapping.
const SEARCH_FIELDS = {
  channels: { from: 'from', in: 'in' },
  task: {
    status: 'status',
    priority: 'priority',
    assignees: 'assignees',
    createdBy: 'created_by',
  },
  calls: { from: 'from', in: 'in', status: 'status' },
  email: { importance: 'importance', inboxIds: 'inboxes' },
} satisfies {
  [Type in keyof Omit<SearchFiltersState, 'type' | 'tags' | 'tagMode'>]: {
    [Field in keyof Omit<
      SearchFiltersState,
      'type' | 'tags' | 'tagMode'
    >[Type]]-?: keyof Extract<SearchExtraction, { type: Type }>;
  };
};

function projectFields<T extends object>(
  input: T,
  mapping: Record<string, keyof T>
) {
  return Object.fromEntries(
    Object.entries(mapping).map(([field, source]) => [field, input[source]])
  );
}

/** Resolve model-selected display values against the same choices as the search editor. */
function optionIds(values: string[], options: { id: string; label: string }[]) {
  return values.map((value) => {
    const matches = options.filter(
      (option) => option.label.toLowerCase() === value.trim().toLowerCase()
    );
    if (matches.length !== 1)
      throw new Error('Choose a supported search filter');
    return matches[0].id;
  });
}

/** The server fixes the type before extracting its fields. Source text is never parsed here. */
export function extractedSearchFields(input: SearchExtraction) {
  const filters = searchFiltersSchema.parse({ type: input.type });
  match(input)
    .with({ type: 'channels' }, (value) => {
      filters.channels = searchFiltersSchema.shape.channels.parse(
        projectFields(value, SEARCH_FIELDS.channels)
      );
    })
    .with({ type: 'task' }, (value) => {
      filters.task = searchFiltersSchema.shape.task.parse({
        ...projectFields(value, SEARCH_FIELDS.task),
        status: optionIds(value.status, TASK_STATUS_OPTIONS),
        priority: optionIds(value.priority, TASK_PRIORITY_OPTIONS),
      });
    })
    .with({ type: 'calls' }, (value) => {
      const status = value.status?.trim().toUpperCase();
      const callStatus =
        status === 'ATTENDED' || status === 'MISSED' || status === 'UNATTENDED'
          ? status
          : undefined;
      if (status && !callStatus)
        throw new Error('Choose a supported call status');
      filters.calls = searchFiltersSchema.shape.calls.parse({
        ...projectFields(value, SEARCH_FIELDS.calls),
        status: callStatus,
      });
    })
    .with({ type: 'email' }, (value) => {
      const importance = value.importance?.trim().toLowerCase();
      if (
        importance &&
        importance !== 'important' &&
        importance !== 'unimportant'
      )
        throw new Error('Choose supported email importance');
      filters.email = searchFiltersSchema.shape.email.parse({
        ...projectFields(value, SEARCH_FIELDS.email),
        importance: importance ? importance === 'important' : undefined,
        inboxIds: value.inboxes.length ? value.inboxes : undefined,
      });
    })
    .with(
      {
        type: P.union(
          'all',
          'document-or-file',
          'folders',
          'agent',
          'calendar'
        ),
      },
      () => {}
    )
    .exhaustive(() => {
      throw new Error('Choose a supported search type');
    });
  return { query: input.query ?? '', searchFilters: filters };
}
