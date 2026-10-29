import {
  extractedSearchFields,
  type SearchExtraction,
} from '../queries/extracted-search';

// Fixed provider answers exercise the UI contract without duplicating a language parser.
const answers: Record<string, SearchExtraction> = {
  'search in progress high priority tasks assigned to julia created by john about android':
    {
      type: 'task',
      query: 'android',
      status: ['In Progress'],
      priority: ['High'],
      assignees: ['Julia'],
      created_by: ['John'],
    },
  'find hiring': { type: 'all', query: 'hiring' },
  'find hiring plan': { type: 'all', query: 'hiring plan' },
  'find how blowholes work': { type: 'all', query: 'how blowholes work' },
  'find how blowholes work in the ocean': {
    type: 'all',
    query: 'how blowholes work in the ocean',
  },
  'search messages from julia': {
    query: null,
    type: 'channels',
    from: ['Julia'],
    in: [],
  },
  'search messages from julia in #sales about budget': {
    query: 'budget',
    type: 'channels',
    from: ['Julia'],
    in: ['sales'],
  },
  'search messages from julia about budget': {
    query: 'budget',
    type: 'channels',
    from: ['Julia'],
    in: [],
  },
  'search messages from julia about forecast': {
    query: 'forecast',
    type: 'channels',
    from: ['Julia'],
    in: [],
  },
  'search messages from Pat about budget': {
    query: 'budget',
    type: 'channels',
    from: ['Pat'],
    in: [],
  },
  'search messages about __budget__': {
    query: '__budget__',
    type: 'channels',
    from: [],
    in: [],
  },
  'search messages about **budget**': {
    query: '**budget**',
    type: 'channels',
    from: [],
    in: [],
  },
  'search messages about forecast': {
    query: 'forecast',
    type: 'channels',
    from: [],
    in: [],
  },
  'search messages in "Julia direct message" about budget': {
    query: 'budget',
    type: 'channels',
    in: ['Julia direct message'],
    from: [],
  },
  'search documents about Scope': { query: 'Scope', type: 'document-or-file' },
};

export function fixtureSearchFields(text: string) {
  return extractedSearchFields(
    answers[text.trim()] ?? { type: 'all', query: text }
  );
}
