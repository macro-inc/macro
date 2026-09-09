/**
 * In-memory fixtures for the CRM lists prototype. Nothing here touches the
 * backend; the shapes are the proposal, not an API.
 *
 * A list is a curated collection over one parent record type (companies or
 * contacts) whose entries carry their own attributes. The same record can sit
 * in several lists with a different state in each, and a list can be boarded
 * by any of its select attributes, not just a stage.
 */

export type ListParentType = 'company' | 'contact';

export type MockRecord = {
  id: string;
  type: ListParentType;
  name: string;
  /** Domain for a company, email for a contact. */
  detail: string;
};

export type ListSelectOption = { id: string; label: string };

export type ListAttribute =
  | { id: string; label: string; kind: 'select'; options: ListSelectOption[] }
  | { id: string; label: string; kind: 'text' }
  | { id: string; label: string; kind: 'currency' }
  | { id: string; label: string; kind: 'date' };

export type MockList = {
  id: string;
  name: string;
  description: string;
  parentType: ListParentType;
  /** Attribute the board groups by until the user picks another. */
  defaultBoardAttributeId: string;
  attributes: ListAttribute[];
};

export type MockEntry = {
  id: string;
  listId: string;
  recordId: string;
  /** Attribute id to value; select attributes hold an option id. */
  values: Record<string, string | number | undefined>;
};

export const RECORDS: MockRecord[] = [
  { id: 'co-linear', type: 'company', name: 'Linear', detail: 'linear.app' },
  { id: 'co-vercel', type: 'company', name: 'Vercel', detail: 'vercel.com' },
  { id: 'co-notion', type: 'company', name: 'Notion', detail: 'notion.so' },
  { id: 'co-figma', type: 'company', name: 'Figma', detail: 'figma.com' },
  { id: 'co-stripe', type: 'company', name: 'Stripe', detail: 'stripe.com' },
  { id: 'co-ramp', type: 'company', name: 'Ramp', detail: 'ramp.com' },
  { id: 'co-loom', type: 'company', name: 'Loom', detail: 'loom.com' },
  { id: 'co-retool', type: 'company', name: 'Retool', detail: 'retool.com' },
  {
    id: 'ct-ada',
    type: 'contact',
    name: 'Ada Okafor',
    detail: 'ada@linear.app',
  },
  {
    id: 'ct-ben',
    type: 'contact',
    name: 'Ben Halvorsen',
    detail: 'ben@vercel.com',
  },
  {
    id: 'ct-cleo',
    type: 'contact',
    name: 'Cleo Marchetti',
    detail: 'cleo@notion.so',
  },
  { id: 'ct-dev', type: 'contact', name: 'Dev Raman', detail: 'dev@figma.com' },
  {
    id: 'ct-esme',
    type: 'contact',
    name: 'Esme Lindqvist',
    detail: 'esme@ramp.com',
  },
  {
    id: 'ct-farid',
    type: 'contact',
    name: 'Farid Haddad',
    detail: 'farid@loom.com',
  },
];

export const LISTS: MockList[] = [
  {
    id: 'deals',
    name: 'Deals',
    description: 'New business, one entry per opportunity.',
    parentType: 'company',
    defaultBoardAttributeId: 'stage',
    attributes: [
      {
        id: 'stage',
        label: 'Stage',
        kind: 'select',
        options: [
          { id: 'deal-lead', label: 'Lead' },
          { id: 'deal-demo', label: 'Demo' },
          { id: 'deal-proposal', label: 'Proposal' },
          { id: 'deal-customer', label: 'Customer' },
          { id: 'deal-churned', label: 'Churned' },
        ],
      },
      { id: 'value', label: 'Contract value', kind: 'currency' },
      { id: 'close', label: 'Close date', kind: 'date' },
      {
        id: 'source',
        label: 'Source',
        kind: 'select',
        options: [
          { id: 'src-inbound', label: 'Inbound' },
          { id: 'src-referral', label: 'Referral' },
          { id: 'src-outbound', label: 'Outbound' },
        ],
      },
    ],
  },
  {
    id: 'renewals',
    name: 'Renewals',
    description: 'Existing customers approaching term end.',
    parentType: 'company',
    defaultBoardAttributeId: 'stage',
    attributes: [
      {
        id: 'stage',
        label: 'Stage',
        kind: 'select',
        options: [
          { id: 'ren-upcoming', label: 'Upcoming' },
          { id: 'ren-talking', label: 'In conversation' },
          { id: 'ren-renewed', label: 'Renewed' },
          { id: 'ren-lost', label: 'Lost' },
        ],
      },
      {
        id: 'health',
        label: 'Health',
        kind: 'select',
        options: [
          { id: 'health-green', label: 'Green' },
          { id: 'health-yellow', label: 'Yellow' },
          { id: 'health-red', label: 'Red' },
        ],
      },
      { id: 'arr', label: 'ARR', kind: 'currency' },
      { id: 'term', label: 'Term end', kind: 'date' },
    ],
  },
  {
    id: 'candidates',
    name: 'Candidates',
    description: 'Hiring pipeline over people, not companies.',
    parentType: 'contact',
    defaultBoardAttributeId: 'stage',
    attributes: [
      {
        id: 'stage',
        label: 'Stage',
        kind: 'select',
        options: [
          { id: 'cand-sourced', label: 'Sourced' },
          { id: 'cand-screen', label: 'Screen' },
          { id: 'cand-onsite', label: 'Onsite' },
          { id: 'cand-offer', label: 'Offer' },
          { id: 'cand-hired', label: 'Hired' },
        ],
      },
      { id: 'role', label: 'Role', kind: 'text' },
      {
        id: 'source',
        label: 'Source',
        kind: 'select',
        options: [
          { id: 'csrc-referral', label: 'Referral' },
          { id: 'csrc-inbound', label: 'Inbound' },
          { id: 'csrc-sourced', label: 'Sourced' },
        ],
      },
    ],
  },
];

export function seedEntries(): MockEntry[] {
  return [
    // Deals: Linear, Notion, Stripe and Figma also appear in Renewals.
    entry('deals', 'co-linear', {
      stage: 'deal-customer',
      value: 48000,
      close: '2026-06-30',
      source: 'src-referral',
    }),
    entry('deals', 'co-vercel', {
      stage: 'deal-demo',
      value: 30000,
      close: '2026-10-15',
      source: 'src-inbound',
    }),
    entry('deals', 'co-notion', {
      stage: 'deal-proposal',
      value: 120000,
      close: '2026-09-30',
      source: 'src-outbound',
    }),
    entry('deals', 'co-figma', {
      stage: 'deal-customer',
      value: 64000,
      close: '2026-03-01',
      source: 'src-inbound',
    }),
    entry('deals', 'co-stripe', {
      stage: 'deal-lead',
      value: undefined,
      close: undefined,
      source: 'src-outbound',
    }),
    entry('deals', 'co-ramp', {
      stage: 'deal-demo',
      value: 22000,
      close: '2026-11-01',
      source: 'src-referral',
    }),
    entry('deals', 'co-loom', {
      stage: 'deal-churned',
      value: 9000,
      close: '2025-12-01',
      source: 'src-inbound',
    }),
    entry('deals', 'co-retool', {
      stage: undefined,
      value: undefined,
      close: undefined,
      source: 'src-inbound',
    }),
    // A second Notion deal: the same record twice in one list.
    entry('deals', 'co-notion', {
      stage: 'deal-lead',
      value: 40000,
      close: '2027-01-15',
      source: 'src-referral',
    }),

    entry('renewals', 'co-linear', {
      stage: 'ren-upcoming',
      health: 'health-green',
      arr: 48000,
      term: '2026-12-31',
    }),
    entry('renewals', 'co-notion', {
      stage: 'ren-talking',
      health: 'health-yellow',
      arr: 96000,
      term: '2026-10-31',
    }),
    entry('renewals', 'co-stripe', {
      stage: 'ren-renewed',
      health: 'health-green',
      arr: 150000,
      term: '2027-06-30',
    }),
    entry('renewals', 'co-figma', {
      stage: 'ren-talking',
      health: 'health-red',
      arr: 64000,
      term: '2026-09-30',
    }),

    entry('candidates', 'ct-ada', {
      stage: 'cand-onsite',
      role: 'Backend engineer',
      source: 'csrc-referral',
    }),
    entry('candidates', 'ct-ben', {
      stage: 'cand-screen',
      role: 'Product designer',
      source: 'csrc-inbound',
    }),
    entry('candidates', 'ct-cleo', {
      stage: 'cand-offer',
      role: 'Backend engineer',
      source: 'csrc-sourced',
    }),
    entry('candidates', 'ct-dev', {
      stage: 'cand-sourced',
      role: 'Frontend engineer',
      source: 'csrc-sourced',
    }),
    entry('candidates', 'ct-esme', {
      stage: 'cand-hired',
      role: 'Account executive',
      source: 'csrc-referral',
    }),
    entry('candidates', 'ct-farid', {
      stage: undefined,
      role: 'Frontend engineer',
      source: 'csrc-inbound',
    }),
  ];
}

let nextEntryId = 0;
function entry(
  listId: string,
  recordId: string,
  values: MockEntry['values']
): MockEntry {
  nextEntryId += 1;
  return { id: `${listId}-${nextEntryId}`, listId, recordId, values };
}
