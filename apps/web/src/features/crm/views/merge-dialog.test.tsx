import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  MergeCandidate,
  MergeCommands,
  MergeRecordType,
  MergeReview,
} from '../core/merge';
import { MergeDialog } from './merge-dialog';

const fixture = vi.hoisted(() => ({
  commands: undefined as unknown as MergeCommands,
  commandsFor: undefined as MergeRecordType | undefined,
  suggestions: [] as {
    id: string;
    name: string;
    domains: { domain: string }[];
    teamId?: string;
  }[],
  people: [] as {
    id: string;
    name: string;
    email?: string | null;
    companyName?: string | null;
    teamId?: string;
  }[],
  /** What the server finds for a typed search, beyond Quick Access. */
  searched: [] as {
    id: string;
    name: string;
    email?: string | null;
    teamId?: string;
  }[],
  companiesSearched: [] as {
    id: string;
    name: string;
    domains: { domain: string }[];
    teamId?: string;
  }[],
  searches: [] as string[],
  hasMore: false,
  loadMore: vi.fn(async () => {}),
  searchError: undefined as unknown,
  retry: vi.fn(async () => {}),
  teamFailed: false,
  teamRefetch: vi.fn(async () => {}),
}));

// Records belong to the viewer's current team unless a test names another.
const inTeam = <T extends { teamId?: string }>(records: T[]) =>
  records.map((record) => ({ teamId: 'team-1', ...record }));

vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    createTeamSource: () => ({
      data: fixture.teamFailed
        ? undefined
        : { team: { id: 'team-1', crm_enabled: true }, members: [] },
      isPending: false,
      isError: fixture.teamFailed,
      refetch: fixture.teamRefetch,
    }),
    // The searches answer whatever the field holds, empty too: listing them
    // only while a search is typed is the dialog's job.
    createCompanySearch: () => ({
      companies: () => inTeam(fixture.companiesSearched),
      isLoading: () => false,
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
      error: () => undefined,
      retry: async () => {},
    }),
    createMergeCommands: (recordType: MergeRecordType) => {
      fixture.commandsFor = recordType;
      return fixture.commands;
    },
    createPropertyValueLabel: () => (_property: string, value: unknown) =>
      (value as { value?: unknown } | null)?.value?.toString(),
    createCompanySuggestions: () => ({
      companies: () => inTeam(fixture.suggestions),
      query: { isLoading: false },
    }),
    createContactSuggestions: () => ({
      contacts: () => inTeam(fixture.people),
      query: { isLoading: false },
    }),
    createContactSearch: (search: () => string) => ({
      contacts: () => {
        fixture.searches.push(search());
        return inTeam(fixture.searched);
      },
      isLoading: () => false,
      hasMore: () => fixture.hasMore,
      isLoadingMore: () => false,
      loadMore: fixture.loadMore,
      error: () => fixture.searchError,
      retry: fixture.retry,
    }),
  }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui/components/ActionDialogShell', () => {
  const Part = (props: ParentProps) => <div>{props.children}</div>;
  return {
    ActionDialogShell: Object.assign(Part, {
      Body: Part,
      Header: Part,
      Title: (props: ParentProps) => <h2>{props.children}</h2>,
      Description: Part,
      Footer: Part,
    }),
  };
});
vi.mock('@ui', async () => {
  const { createContext, useContext } = await import('solid-js');
  const Group = createContext<{
    value: () => string | undefined;
    disabled: () => boolean;
    onChange: (value: string) => void;
  }>();
  const RadioGroup = Object.assign(
    (
      props: ParentProps<{
        value?: string;
        disabled?: boolean;
        onChange: (value: string) => void;
        'aria-label'?: string;
      }>
    ) => (
      <Group.Provider
        value={{
          value: () => props.value,
          disabled: () => props.disabled ?? false,
          onChange: props.onChange,
        }}
      >
        <div role="radiogroup" aria-label={props['aria-label']}>
          {props.children}
        </div>
      </Group.Provider>
    ),
    {
      Item: (props: ParentProps<{ value: string; disabled?: boolean }>) => {
        const group = useContext(Group)!;
        return (
          <label>
            <input
              type="radio"
              value={props.value}
              checked={group.value() === props.value}
              disabled={props.disabled || group.disabled()}
              onChange={() => group.onChange(props.value)}
            />
            {props.children}
          </label>
        );
      },
      ItemControl: () => null,
      ItemLabel: (props: ParentProps) => <span>{props.children}</span>,
    }
  );
  const Checkbox = Object.assign(
    (
      props: ParentProps<{
        checked: boolean;
        onChange: (checked: boolean) => void;
      }>
    ) => (
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
        {props.children}
      </label>
    ),
    {
      Control: () => null,
      Label: (props: ParentProps) => <span>{props.children}</span>,
    }
  );
  return {
    Badge: (props: ParentProps) => <span>{props.children}</span>,
    Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props} />
    ),
    Checkbox,
    Dialog: (props: ParentProps<{ open: boolean }>) => (
      <div role="dialog">{props.open && props.children}</div>
    ),
    Input: (props: JSX.InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
    RadioGroup,
    Spinner: () => <span data-spinner />,
  };
});

const KEPT = {
  id: 'kept',
  name: 'Kept Co',
  identifiers: ['kept.example.com'],
};
const OLD = { id: 'old', name: 'Old Co', identifiers: ['old.example.com'] };

function review(overrides: Partial<MergeReview> = {}): MergeReview {
  return {
    revision: 'rev-1',
    survivor: { id: 'kept', name: 'Kept Co' },
    sources: [{ id: 'old', name: 'Old Co' }],
    identifiers: ['kept.example.com', 'old.example.com'],
    moves: {
      contacts: 2,
      pipelineEntries: 1,
      references: 0,
      discussionMessages: 3,
    },
    sharedPipelines: [{ pipelineId: 'p1', name: 'Deals', entriesAfter: 2 }],
    conflicts: [
      {
        propertyId: 'tier',
        propertyName: 'Tier',
        kept: { type: 'String', value: 'Gold' },
        dropped: [
          { recordId: 'old', value: { type: 'String', value: 'Silver' } },
        ],
      },
    ],
    emailSync: { survivorSyncs: true, keptOut: ['old.example.com'] },
    sharingRules: { teammates: 1, keepFits: true },
    blocked: null,
    ...overrides,
  };
}

let onMerged: ReturnType<
  typeof vi.fn<
    (merge: {
      survivor: { id: string; name: string };
      merged: { id: string; name: string }[];
    }) => void
  >
>;
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>;

beforeEach(() => {
  onMerged = vi.fn();
  onOpenChange = vi.fn();
  fixture.suggestions = [];
  fixture.people = [];
  fixture.searched = [];
  fixture.companiesSearched = [];
  fixture.searches = [];
  fixture.hasMore = false;
  fixture.loadMore.mockClear();
  fixture.searchError = undefined;
  fixture.retry.mockClear();
  fixture.teamFailed = false;
  fixture.teamRefetch.mockClear();
  fixture.commandsFor = undefined;
});
afterEach(cleanup);

function open(
  records: MergeCandidate[] = [KEPT, OLD],
  recordType: MergeRecordType = 'company'
) {
  render(() => (
    <MergeDialog
      open
      onOpenChange={onOpenChange}
      recordType={recordType}
      records={records}
      onMerged={onMerged}
    />
  ));
}

async function reviewKeeping(name: string) {
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
  fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));
  await screen.findByText(/This can’t be undone/);
}

it('reviews the merge into the company kept and commits that review', async () => {
  const commit = vi.fn(async () => ({
    ok: true as const,
    value: { survivorId: 'kept', mergedIds: ['old'] },
  }));
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: review() })),
    commit,
  };
  open();

  await reviewKeeping('Kept Co');

  expect(fixture.commands.review).toHaveBeenCalledWith({
    survivorId: 'kept',
    sourceIds: ['old'],
  });
  const text = document.body.textContent ?? '';
  expect(text).toContain('Merge into Kept Co');
  expect(text).toContain('2 people');
  expect(text).toContain('3 discussion messages');
  expect(text).toContain('Deals: 2 separate entries after the merge');
  expect(text).toContain('Gold');
  expect(text).toContain('Silver');
  expect(text).toContain('Mail from old.example.com stays out');
  expect(text).toContain('1 teammate shares mail from a company being merged.');
  expect(
    screen.getByRole('radio', { name: 'Keep sharing the same mail' })
  ).toHaveProperty('checked', true);

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await vi.waitFor(() => expect(onMerged).toHaveBeenCalled());
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      survivorId: 'kept',
      sourceIds: ['old'],
      revision: 'rev-1',
      sharingRules: 'keep',
    })
  );
  expect(onMerged).toHaveBeenCalledWith({
    survivor: KEPT,
    merged: [OLD],
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('stops sharing when keeping it would not fit, and keeping can’t be chosen', async () => {
  const commit = vi.fn(async () => ({
    ok: true as const,
    value: { survivorId: 'kept', mergedIds: ['old'] },
  }));
  fixture.commands = {
    review: vi.fn(async () => ({
      ok: true as const,
      value: review({ sharingRules: { teammates: 2, keepFits: false } }),
    })),
    commit,
  };
  open();
  await reviewKeeping('Kept Co');

  const keep = screen.getByRole('radio', {
    name: 'Keep sharing the same mail',
  });
  expect(keep).toHaveProperty('disabled', true);
  expect(screen.getByRole('radio', { name: 'Stop sharing it' })).toHaveProperty(
    'checked',
    true
  );
  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await vi.waitFor(() => expect(commit).toHaveBeenCalled());
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({ sharingRules: 'stop' })
  );
});

it('reviews again when the review went stale, and commits the new one under a new key', async () => {
  const reviews = [review(), review({ revision: 'rev-2' })];
  const commit = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      refusal: { code: 'merge_preview_stale' },
    })
    .mockResolvedValueOnce({
      ok: true,
      value: { survivorId: 'kept', mergedIds: ['old'] },
    });
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: reviews.shift()! })),
    commit,
  };
  open();
  await reviewKeeping('Kept Co');

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await screen.findByText(
    'Something changed since the review. Check it again.'
  );
  expect(onMerged).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await vi.waitFor(() => expect(onMerged).toHaveBeenCalled());
  const [first, second] = commit.mock.calls.map(([input]) => input);
  expect(second.revision).toBe('rev-2');
  expect(second.requestKey).not.toBe(first.requestKey);
});

it('lists people sharing an address, archived ones too, and offers no merge', async () => {
  fixture.commands = {
    review: vi.fn(async () => ({
      ok: true as const,
      value: review({
        blocked: {
          kind: 'same_address_people',
          people: [
            {
              contactId: 'c1',
              name: 'Pat',
              address: 'pat@old.example.com',
              recordId: 'old',
              archived: true,
            },
          ],
        },
      }),
    })),
    commit: vi.fn(),
  };
  open();
  fireEvent.click(screen.getByRole('radio', { name: /Kept Co/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));

  await screen.findByText('Two people here have the same email address');
  expect(document.body.textContent).toContain(
    'Pat (pat@old.example.com) in Old Co'
  );
  expect(document.body.textContent).toContain('Archived');
  expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
});

it('reads a block this build doesn’t know as a generic refusal', async () => {
  fixture.commands = {
    review: vi.fn(async () => ({
      ok: true as const,
      value: review({ blocked: { kind: 'unknown' } }),
    })),
    commit: vi.fn(),
  };
  open();
  fireEvent.click(screen.getByRole('radio', { name: /Kept Co/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));

  await screen.findByText('These companies can’t be merged yet');
  expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
});

it('explains a refused review', async () => {
  fixture.commands = {
    review: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'merge_permission_required' },
    })),
    commit: vi.fn(),
  };
  open();
  fireEvent.click(screen.getByRole('radio', { name: /Kept Co/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));

  await screen.findByText('Only team admins and owners can merge companies.');
});

it('starting from one company, picks the others first', async () => {
  fixture.suggestions = [
    { id: 'kept', name: 'Kept Co', domains: [{ domain: 'kept.example.com' }] },
    {
      id: 'other',
      name: 'Other Co',
      domains: [{ domain: 'other.example.com' }],
    },
  ];
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: review() })),
    commit: vi.fn(),
  };
  open([OLD]);

  expect(screen.getByText('Merge with another company')).toBeTruthy();
  const continueButton = screen.getByRole('button', { name: 'Continue' });
  expect(continueButton).toHaveProperty('disabled', true);
  fireEvent.input(screen.getByLabelText('Search companies'), {
    target: { value: 'kept' },
  });
  expect(screen.queryByText('Other Co')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  await reviewKeeping('Kept Co');
  expect(fixture.commands.review).toHaveBeenCalledWith({
    survivorId: 'kept',
    sourceIds: ['old'],
  });
});

it('commits the review it shows, even when an earlier review answers last', async () => {
  let answerFirst!: (value: { ok: true; value: MergeReview }) => void;
  const commit = vi.fn(async () => ({
    ok: true as const,
    value: { survivorId: 'old', mergedIds: ['kept'] },
  }));
  fixture.commands = {
    review: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirst = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        value: review({
          revision: 'rev-old',
          survivor: { id: 'old', name: 'Old Co' },
          sources: [{ id: 'kept', name: 'Kept Co' }],
        }),
      }),
    commit,
  };
  open();

  fireEvent.click(screen.getByRole('radio', { name: /Kept Co/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await reviewKeeping('Old Co');
  answerFirst({ ok: true, value: review({ revision: 'rev-kept' }) });
  await Promise.resolve();

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await vi.waitFor(() => expect(commit).toHaveBeenCalled());
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      survivorId: 'old',
      sourceIds: ['kept'],
      revision: 'rev-old',
    })
  );
});

it('keeps the review after an unconfirmed commit and retries it under the same key', async () => {
  const commit = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      refusal: { code: 'merge_unconfirmed' },
    })
    .mockResolvedValueOnce({
      ok: true,
      value: { survivorId: 'kept', mergedIds: ['old'] },
    });
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: review() })),
    commit,
  };
  open();
  await reviewKeeping('Kept Co');

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await screen.findByText(
    'We couldn’t confirm the merge. Merge again to finish it; it won’t run twice.'
  );
  expect(fixture.commands.review).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await vi.waitFor(() => expect(onMerged).toHaveBeenCalled());
  const [first, second] = commit.mock.calls.map(([input]) => input);
  expect(second.requestKey).toBe(first.requestKey);
});

it('retries an unconfirmed commit with the sharing choice it sent, which stays locked', async () => {
  const commit = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      refusal: { code: 'merge_unconfirmed' },
    })
    .mockResolvedValueOnce({
      ok: true,
      value: { survivorId: 'kept', mergedIds: ['old'] },
    });
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: review() })),
    commit,
  };
  open();
  await reviewKeeping('Kept Co');

  fireEvent.click(screen.getByRole('radio', { name: 'Stop sharing it' }));
  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await screen.findByText(
    'We couldn’t confirm the merge. Merge again to finish it; it won’t run twice.'
  );
  const stop = screen.getByRole('radio', { name: 'Stop sharing it' });
  expect(stop).toHaveProperty('checked', true);
  expect(stop).toHaveProperty('disabled', true);

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 companies' }));
  await vi.waitFor(() => expect(onMerged).toHaveBeenCalled());
  const [first, second] = commit.mock.calls.map(([input]) => input);
  expect(first.sharingRules).toBe('stop');
  expect(second).toEqual(first);
});

const PAT = {
  id: 'pat',
  name: 'Pat Lee',
  identifiers: ['pat@acme.example.com'],
  company: 'Acme',
};
const PAT_L = {
  id: 'pat-l',
  name: 'Pat L.',
  identifiers: ['pat@home.example.com'],
  company: 'Acme',
};

function peopleReview(overrides: Partial<MergeReview> = {}): MergeReview {
  return review({
    survivor: { id: 'pat', name: 'Pat Lee' },
    sources: [{ id: 'pat-l', name: 'Pat L.' }],
    identifiers: ['pat@acme.example.com', 'pat@home.example.com'],
    moves: {
      contacts: 0,
      pipelineEntries: 1,
      references: 2,
      discussionMessages: 0,
    },
    sharedPipelines: [],
    conflicts: [],
    emailSync: { survivorSyncs: true, keptOut: [] },
    ...overrides,
  });
}

it('reviews a merge of people: their addresses, what moves, and who stays', async () => {
  const commit = vi.fn(async () => ({
    ok: true as const,
    value: { survivorId: 'pat', mergedIds: ['pat-l'] },
  }));
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: peopleReview() })),
    commit,
  };
  open([PAT, PAT_L], 'contact');
  expect(fixture.commandsFor).toBe('contact');
  expect(
    screen.getByRole('radiogroup', { name: 'Person to keep' })
  ).toBeTruthy();
  expect(document.body.textContent).toContain('pat@home.example.com · Acme');

  await reviewKeeping('Pat Lee');

  const text = document.body.textContent ?? '';
  expect(text).toContain('Merge into Pat Lee');
  expect(text).toContain('Pat L. goes away. Links to them open Pat Lee.');
  expect(text).toContain('Addresses');
  expect(text).toContain('pat@acme.example.com');
  expect(text).toContain('pat@home.example.com');
  expect(text).toContain('1 pipeline entry');
  expect(text).toContain('2 linked items');
  expect(text).not.toContain('Domains');
  expect(
    screen.queryByText(/^\d+ (person|people)$/),
    'people are the records merged, not what moves'
  ).toBeNull();
  expect(text).toContain('1 teammate shares mail from a person being merged.');

  fireEvent.click(screen.getByRole('button', { name: 'Merge 2 people' }));
  await vi.waitFor(() => expect(onMerged).toHaveBeenCalled());
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({ survivorId: 'pat', sourceIds: ['pat-l'] })
  );
});

it('lists people under another company, and offers no merge', async () => {
  fixture.commands = {
    review: vi.fn(async () => ({
      ok: true as const,
      value: peopleReview({
        blocked: {
          kind: 'different_companies',
          people: [
            {
              contactId: 'pat-l',
              name: null,
              companyId: 'globex',
              companyName: 'Globex',
            },
          ],
        },
      }),
    })),
    commit: vi.fn(),
  };
  open([PAT, PAT_L], 'contact');
  fireEvent.click(screen.getByRole('radio', { name: /Pat Lee/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));

  await screen.findByText('Some of these people are under other companies');
  expect(document.body.textContent).toContain('Pat L. in Globex');
  expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
});

it('explains a refused merge of people in their words', async () => {
  fixture.commands = {
    review: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'record_hidden' },
    })),
    commit: vi.fn(),
  };
  open([PAT, PAT_L], 'contact');
  fireEvent.click(screen.getByRole('radio', { name: /Pat Lee/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));

  await screen.findByText(
    'One of these people is archived. Restore them first.'
  );
});

it('starting from one person, finds the others by name, address or company', async () => {
  fixture.people = [
    {
      id: 'pat',
      name: 'Pat Lee',
      email: 'pat@acme.example.com',
      companyName: 'Acme',
    },
    {
      id: 'sam',
      name: 'Sam Doe',
      email: 'sam@globex.example.com',
      companyName: 'Initech',
    },
    // Without a name, a person is listed by their address, once.
    {
      id: 'anon',
      name: 'anon@acme.example.com',
      email: 'anon@acme.example.com',
    },
  ];
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: peopleReview() })),
    commit: vi.fn(),
  };
  open([PAT_L], 'contact');

  expect(screen.getByText('Merge with another person')).toBeTruthy();
  expect(
    screen.getByText(/^Choose the people who are the same as Pat L\./)
  ).toBeTruthy();
  expect(
    screen.getAllByText('anon@acme.example.com'),
    'the address isn’t repeated under it'
  ).toHaveLength(1);
  const search = screen.getByLabelText('Search people');
  // By company: no address names it.
  fireEvent.input(search, { target: { value: 'initech' } });
  expect(screen.queryByText('Pat Lee')).toBeNull();
  expect(screen.getByText('Sam Doe')).toBeTruthy();
  fireEvent.input(search, { target: { value: 'pat@acme' } });
  expect(screen.queryByText('Sam Doe')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  await reviewKeeping('Pat Lee');
  expect(fixture.commands.review).toHaveBeenCalledWith({
    survivorId: 'pat',
    sourceIds: ['pat-l'],
  });
});

it('finds a person beyond Quick Access through the server, and reads more pages', async () => {
  fixture.people = [
    { id: 'pat', name: 'Pat Lee', email: 'pat@acme.example.com' },
  ];
  fixture.searched = [
    { id: 'pat', name: 'Pat Lee', email: 'pat@acme.example.com' },
    { id: 'old-pat', name: 'Pat Leigh', email: 'pleigh@acme.example.com' },
    { id: 'other-pat', name: 'P. Leigh', email: 'pleigh@acme.example.com' },
  ];
  fixture.hasMore = true;
  fixture.commands = {
    review: vi.fn(async () => ({ ok: true as const, value: peopleReview() })),
    commit: vi.fn(),
  };
  open([PAT_L], 'contact');

  expect(screen.queryByText('Pat Leigh')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Show more' }),
    'nothing to page before a search'
  ).toBeNull();
  fireEvent.input(screen.getByLabelText('Search people'), {
    target: { value: 'pat le' },
  });
  expect(fixture.searches).toContain('pat le');
  expect(
    screen.getAllByText('Pat Lee'),
    'a match in both is listed once'
  ).toHaveLength(1);
  expect(screen.getByText('Pat Leigh')).toBeTruthy();
  expect(
    screen.getByText('P. Leigh'),
    'two people holding one address both list'
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(fixture.loadMore).toHaveBeenCalled();
});

it('says a failed search failed, with Retry, instead of no one matching', async () => {
  fixture.searchError = new Error('offline');
  fixture.commands = { review: vi.fn(), commit: vi.fn() };
  open([PAT_L], 'contact');

  fireEvent.input(screen.getByLabelText('Search people'), {
    target: { value: 'nobody cached' },
  });
  expect(screen.getByText('Couldn’t search people.')).toBeTruthy();
  expect(screen.queryByText('No other people match.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(fixture.retry).toHaveBeenCalled();
});

it('keeps the matches it has when a later page fails, with Retry beside them', async () => {
  fixture.searched = [
    { id: 'old-pat', name: 'Pat Leigh', email: 'pleigh@acme.example.com' },
  ];
  fixture.searchError = new Error('next page failed');
  fixture.commands = { review: vi.fn(), commit: vi.fn() };
  open([PAT_L], 'contact');

  fireEvent.input(screen.getByLabelText('Search people'), {
    target: { value: 'pat le' },
  });
  expect(screen.getByText('Pat Leigh')).toBeTruthy();
  expect(screen.getByText('Couldn’t search people.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(fixture.retry).toHaveBeenCalled();
});

it('finds a company beyond Quick Access through the search service', async () => {
  fixture.suggestions = [
    { id: 'kept', name: 'Kept Co', domains: [{ domain: 'kept.example.com' }] },
  ];
  fixture.companiesSearched = [
    {
      id: 'older',
      name: 'Older Kept Co',
      domains: [{ domain: 'older-kept.example.com' }],
    },
  ];
  fixture.commands = { review: vi.fn(), commit: vi.fn() };
  open([OLD]);

  expect(screen.queryByText('Older Kept Co')).toBeNull();
  fireEvent.input(screen.getByLabelText('Search companies'), {
    target: { value: 'kept' },
  });
  expect(screen.getByText('Kept Co')).toBeTruthy();
  expect(screen.getByText('Older Kept Co')).toBeTruthy();
});

it('lists only the current team’s companies and people to merge with', async () => {
  fixture.suggestions = [
    { id: 'kept', name: 'Kept Co', domains: [{ domain: 'kept.example.com' }] },
    {
      id: 'theirs',
      name: 'Kept Co Elsewhere',
      domains: [{ domain: 'kept-elsewhere.example.com' }],
      teamId: 'team-2',
    },
  ];
  fixture.companiesSearched = [
    {
      id: 'theirs-older',
      name: 'Kept Co Abroad',
      domains: [{ domain: 'kept-abroad.example.com' }],
      teamId: 'team-2',
    },
  ];
  fixture.commands = { review: vi.fn(), commit: vi.fn() };
  open([OLD]);
  fireEvent.input(screen.getByLabelText('Search companies'), {
    target: { value: 'kept' },
  });
  expect(screen.getByText('Kept Co')).toBeTruthy();
  expect(screen.queryByText('Kept Co Elsewhere')).toBeNull();
  expect(screen.queryByText('Kept Co Abroad')).toBeNull();
  cleanup();

  fixture.people = [
    { id: 'pat', name: 'Pat Lee', email: 'pat@acme.example.com' },
    {
      id: 'their-pat',
      name: 'Pat Lane',
      email: 'plane@acme.example.com',
      teamId: 'team-2',
    },
  ];
  fixture.searched = [
    {
      id: 'their-other-pat',
      name: 'Pat Long',
      email: 'plong@acme.example.com',
      teamId: 'team-2',
    },
  ];
  open([PAT_L], 'contact');
  fireEvent.input(screen.getByLabelText('Search people'), {
    target: { value: 'pat' },
  });
  expect(screen.getByText('Pat Lee')).toBeTruthy();
  expect(screen.queryByText('Pat Lane')).toBeNull();
  expect(screen.queryByText('Pat Long')).toBeNull();
});

it('without the current team, lists no one and offers Retry for the team', async () => {
  fixture.teamFailed = true;
  fixture.suggestions = [
    { id: 'kept', name: 'Kept Co', domains: [{ domain: 'kept.example.com' }] },
  ];
  fixture.commands = { review: vi.fn(), commit: vi.fn() };
  open([OLD]);

  expect(screen.queryByText('Kept Co')).toBeNull();
  expect(screen.getByText('Couldn’t search companies.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(fixture.teamRefetch).toHaveBeenCalled();
  expect(fixture.retry).not.toHaveBeenCalled();
});
