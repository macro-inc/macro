import type { AgentSessionEntity, ChatEntity } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createResource, createSignal, type JSX, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toHistoryRecord } from '../queries/run-resource';
import {
  type HistoryMetadata,
  type HistoryRecord,
  RoutineHistory,
} from './routine-history';

vi.mock('@entity', () => ({
  formatDateAndTime: (value: string) => value,
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
afterEach(cleanup);

function record(
  type: 'chat' | 'agent',
  id: string,
  overrides: Partial<Parameters<typeof toHistoryRecord>[0]> = {}
): HistoryRecord {
  return toHistoryRecord({
    id: `run-${id}`,
    resource_id: id,
    result: { version: 1, resource: { type, id } },
    start_time: id,
    is_success: true,
    ...overrides,
  });
}
function entity(
  type: 'chat' | 'agent',
  id: string,
  name: string
): ChatEntity | AgentSessionEntity {
  const base = {
    id,
    name,
    ownerId: 'owner',
    updatedAt: '2026-10-05T12:00:00Z',
  };
  return type === 'agent'
    ? { ...base, type: 'agent_session', botId: 'bot', status: 'idle' }
    : { ...base, type: 'chat' };
}
function sources() {
  return {
    createChatMetadata: vi.fn(
      (id: string) => (): HistoryMetadata => ({
        status: 'ready',
        entity: entity('chat', id, `Chat ${id}`),
      })
    ),
    createAgentMetadata: vi.fn(
      (id: string) => (): HistoryMetadata => ({
        status: 'ready',
        entity: entity('agent', id, `Agent ${id}`),
      })
    ),
    onOpen: vi.fn(),
  };
}
function row(name: string | RegExp) {
  return screen.getByRole('listitem', { name });
}

describe('routine history', () => {
  it('opens the conversation of a run that only ran its agent, from each result', () => {
    const source = sources();
    render(() => (
      <RoutineHistory
        {...source}
        isPending={false}
        records={[
          record('chat', 'chat'),
          record('agent', 'session', { resource_id: 'not-a-chat' }),
          record('chat', 'legacy-null', { result: null }),
          record('chat', 'legacy-error', {
            result: 'Old error',
            is_success: false,
          }),
        ]}
      />
    ));
    expect(source.createChatMetadata.mock.calls).toEqual([
      ['chat'],
      ['legacy-null'],
      ['legacy-error'],
    ]);
    expect(source.createAgentMetadata.mock.calls).toEqual([['session']]);
    // Runs without steps have nothing to show beside the list.
    expect(screen.queryByRole('region', { name: 'Run details' })).toBeNull();
    fireEvent.click(within(row('Chat chat')).getByRole('button'));
    fireEvent.keyDown(within(row('Agent session')).getByRole('button'), {
      key: 'Enter',
      shiftKey: true,
    });
    fireEvent.click(within(row('Chat legacy-error')).getByRole('button'), {
      shiftKey: true,
    });
    expect(source.onOpen.mock.calls).toEqual([
      [{ type: 'chat', id: 'chat' }, false],
      [{ type: 'agent', id: 'session' }, true],
      [{ type: 'chat', id: 'legacy-error' }, true],
    ]);
  });

  it('marks how each run ended and shows why one failed', () => {
    render(() => (
      <RoutineHistory
        {...sources()}
        isPending={false}
        records={[
          record('agent', 'pending', { id: undefined, is_success: false }),
          record('agent', 'failed', {
            is_success: false,
            result: {
              version: 1,
              resource: { type: 'agent', id: 'failed' },
              error: 'Model unavailable',
            },
          }),
          record('agent', 'success', { start_time: '2026-10-04T12:00:00Z' }),
        ]}
      />
    ));
    expect(within(row('Agent pending')).getByText('Running')).toBeTruthy();
    const failed = within(row('Agent failed'));
    expect(failed.getByText('Failed')).toBeTruthy();
    expect(failed.getByText('Model unavailable').className).toContain(
      'text-failure'
    );
    expect(within(row('Agent success')).getByText('Succeeded')).toBeTruthy();
  });

  it.each([
    { result: null, resource_id: null },
    {
      result: { version: 1, resource: null, error: 'Preparation failed' },
      resource_id: 'unsafe',
    },
    {
      result: { version: 2, resource: { type: 'agent', id: 'unsafe' } },
      resource_id: 'unsafe',
    },
    {
      result: { version: 1, resource: { type: 'other', id: 'unsafe' } },
      resource_id: 'unsafe',
    },
    { result: undefined, resource_id: 'unsafe' },
  ])(
    'keeps unavailable resources visible without queries or navigation: %j',
    (invalid) => {
      const source = sources();
      render(() => (
        <RoutineHistory
          {...source}
          isPending={false}
          records={[
            record('agent', 'missing', { ...invalid, is_success: false }),
          ]}
        />
      ));
      // A run that failed before any step says so; others lost their transcript.
      fireEvent.click(screen.getByText(/^Run (unavailable|failed)$/));
      expect(screen.queryByRole('button')).toBeNull();
      expect(source.onOpen).not.toHaveBeenCalled();
      expect(source.createChatMetadata).not.toHaveBeenCalled();
      expect(source.createAgentMetadata).not.toHaveBeenCalled();
      expect(screen.getByText('Failed')).toBeTruthy();
    }
  );

  it('isolates loading and unavailable metadata while retaining other sessions', () => {
    const source = sources();
    const [metadata, setMetadata] = createSignal<HistoryMetadata>({
      status: 'pending',
    });
    source.createAgentMetadata.mockReturnValue(metadata);
    render(() => (
      <RoutineHistory
        {...source}
        isPending={false}
        records={[record('agent', 'session'), record('chat', 'ready')]}
      />
    ));
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(row('Chat ready')).toBeTruthy();
    setMetadata({ status: 'unavailable' });
    expect(within(row('Run unavailable')).queryByRole('button')).toBeNull();
    setMetadata({ status: 'ready', entity: entity('agent', 'session', '  ') });
    expect(row('Untitled run')).toBeTruthy();
  });

  it('catches suspending metadata at the row without detaching siblings', () => {
    const source = sources();
    source.createAgentMetadata.mockImplementation(() => {
      const [name] = createResource(() => new Promise<string>(() => {}));
      return () => ({
        status: 'ready',
        entity: entity('agent', 'session', name() ?? ''),
      });
    });
    render(() => (
      <Suspense fallback={<div>Outer loading</div>}>
        <div>Editor</div>
        <RoutineHistory
          {...source}
          isPending={false}
          records={[record('agent', 'session'), record('chat', 'ready')]}
        />
      </Suspense>
    ));
    expect(screen.queryByText('Outer loading')).toBeNull();
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(row('Chat ready')).toBeTruthy();
  });

  it('replaces a resource with the correct metadata source when records change', () => {
    const source = sources();
    const [records, setRecords] = createSignal([record('chat', 'first')]);
    render(() => (
      <RoutineHistory {...source} records={records()} isPending={false} />
    ));
    setRecords([record('agent', 'second')]);
    expect(screen.queryByRole('listitem', { name: 'Chat first' })).toBeNull();
    fireEvent.click(within(row('Agent second')).getByRole('button'));
    expect(source.onOpen).toHaveBeenCalledWith(
      { type: 'agent', id: 'second' },
      false
    );
  });

  it('loads bounded pages without fetching hidden sessions', () => {
    const source = sources();
    const [pending, setPending] = createSignal(true);
    const [records, setRecords] = createSignal<HistoryRecord[]>([]);
    render(() => (
      <RoutineHistory {...source} records={records()} isPending={pending()} />
    ));
    expect(screen.getByText('Loading…')).toBeTruthy();
    setPending(false);
    expect(screen.getByText('No runs yet.')).toBeTruthy();
    setRecords(
      Array.from({ length: 51 }, (_, index) => record('agent', String(index)))
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(source.createAgentMetadata).toHaveBeenCalledTimes(50);
    fireEvent.click(screen.getByRole('button', { name: 'Load more runs' }));
    expect(source.createAgentMetadata).toHaveBeenCalledTimes(51);
    expect(screen.getAllByRole('listitem')).toHaveLength(51);
    expect(screen.queryByText('Load more runs')).toBeNull();
  });

  it('groups runs under the day they started', () => {
    const today = new Date();
    today.setHours(9, 30, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    render(() => (
      <RoutineHistory
        {...sources()}
        isPending={false}
        records={[
          record('agent', 'new', { start_time: today.toISOString() }),
          record('agent', 'old', { start_time: yesterday.toISOString() }),
        ]}
      />
    ));
    const list = screen.getByRole('list', { name: 'Routine runs' });
    expect(
      [...list.children].map((child) => child.textContent?.split('Agent')[0])
    ).toEqual(['Today', expect.anything(), 'Yesterday', expect.anything()]);
  });
});

describe('skipped runs', () => {
  function skip(id: string, condition: unknown, error: string | null = null) {
    return record('agent', id, {
      id: `skip-${id}`,
      resource_id: null,
      result: { version: 1, resource: null, error, condition },
    });
  }

  it('shows why a lone run was skipped without loading a resource', () => {
    const source = sources();
    render(() => (
      <RoutineHistory
        {...source}
        isPending={false}
        records={[
          skip('a', { status: 'not_met', probability: 0.12 }),
          record('agent', 'ran'),
          skip(
            'b',
            { status: 'unavailable' },
            'The condition couldn’t be checked.'
          ),
        ]}
      />
    ));
    const unmet = within(row('Condition not met'));
    expect(unmet.getByText('Skipped')).toBeTruthy();
    expect(unmet.getByText('12% likely yes').className).not.toContain(
      'text-failure'
    );
    const unavailable = within(row('Condition couldn’t be checked'));
    expect(
      unavailable.getByText('The condition couldn’t be checked.').className
    ).toContain('text-failure');
    expect(source.createAgentMetadata.mock.calls).toEqual([['ran']]);
  });

  it('collapses consecutive skips between runs', () => {
    render(() => (
      <RoutineHistory
        {...sources()}
        isPending={false}
        records={[
          record('agent', 'newest'),
          skip('a', { status: 'not_met', probability: 0.1 }),
          skip('b', { status: 'not_met', probability: 0.2 }),
          skip('c', { status: 'not_met', probability: 0.3 }),
          record('agent', 'oldest'),
        ]}
      />
    ));
    expect(screen.queryByText('Condition not met')).toBeNull();
    const group = within(row('3 skipped by the condition')).getByRole('button');
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(group.textContent).toContain('Show');
    fireEvent.click(group);
    expect(group.textContent).toContain('Hide');
    expect(screen.getAllByText('Condition not met')).toHaveLength(3);
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('aria-label'))
    ).toEqual([
      'Agent newest',
      '3 skipped by the condition',
      'Condition not met',
      'Condition not met',
      'Condition not met',
      'Agent oldest',
    ]);
  });
});

describe('routine history steps', () => {
  function triage() {
    return toHistoryRecord({
      id: 'run-steps',
      result: {
        version: 1,
        resource: null,
        error: 'SendChannelMessage failed: No access',
        steps: [
          { path: '0', kind: 'choose', choices: ['Invoice'], probability: 0.9 },
          { path: '0.options.0.0', kind: 'tool', tool: 'UpdateThreadLabels' },
          {
            path: '0.options.0.1',
            kind: 'tool',
            tool: 'SendChannelMessage',
            error: 'No access',
          },
        ],
      },
      start_time: '2026-10-09T10:00:00Z',
      end_time: '2026-10-09T10:00:03Z',
      is_success: false,
    });
  }
  function weekly(id: string) {
    return toHistoryRecord({
      id,
      result: {
        version: 1,
        resource: null,
        steps: [
          { path: '0', kind: 'tool', tool: 'CreateDocument' },
          { path: '1', kind: 'if', answer: false, probability: 0.2 },
        ],
      },
      start_time: '2026-10-08T10:00:00Z',
      is_success: true,
    });
  }
  const describeRunStep = (
    step: Parameters<
      NonNullable<Parameters<typeof RoutineHistory>[0]['describeStep']>
    >[0]
  ) =>
    step.kind === 'tool'
      ? `${step.tool}${step.error ? ` failed: ${step.error}` : ''}`
      : step.kind === 'choose'
        ? `Chose ${step.choices?.join(', ')}`
        : step.kind === 'if'
          ? `Urgent? ${step.answer ? 'yes' : 'no'}`
          : 'Asked AI';

  it('reads each run in two lines and shows the newest one beside the list', () => {
    const agentOnly = record('agent', 'agent-run', {
      result: {
        version: 1,
        resource: { type: 'agent', id: 'agent-run' },
        steps: [{ path: '0', kind: 'agent' }],
      },
    });
    const source = sources();
    render(() => (
      <RoutineHistory
        {...source}
        records={[agentOnly, triage(), weekly('run-weekly')]}
        isPending={false}
        describeStep={describeRunStep}
      />
    ));
    // Its first step names the run; the failed step says why it stopped.
    const run = within(row('Chose Invoice'));
    expect(
      run.getByText('SendChannelMessage failed: No access').className
    ).toContain('text-failure');
    expect(within(row('CreateDocument')).getByText('Urgent? no')).toBeTruthy();

    const details = within(screen.getByRole('region', { name: 'Run details' }));
    expect(
      details.getByRole('heading', { name: 'Chose Invoice' })
    ).toBeTruthy();
    expect(details.getByText(/Failed · took 3\.0 s · 1 AI call/)).toBeTruthy();
    expect(details.getByText('90%')).toBeTruthy();
    expect(details.getByText('SendChannelMessage')).toBeTruthy();
    expect(details.getByText('No access').className).toContain('text-failure');

    fireEvent.click(within(row('CreateDocument')).getByRole('button'));
    expect(
      details.queryByRole('heading', { name: 'Chose Invoice' })
    ).toBeNull();
    expect(details.getByText('No')).toBeTruthy();
    expect(details.getByText('80%')).toBeTruthy();

    // A run that only asked its agent opens the conversation instead.
    fireEvent.click(within(row('Agent agent-run')).getByRole('button'));
    expect(source.onOpen).toHaveBeenCalledWith(
      { type: 'agent', id: 'agent-run' },
      false
    );
  });

  it('opens an agent step’s conversation from the run', () => {
    const source = sources();
    const program = record('agent', 'program', {
      result: {
        version: 1,
        resource: { type: 'agent', id: 'program' },
        steps: [
          { path: '0', kind: 'if', answer: true, probability: 0.97 },
          { path: '0.then.0', kind: 'agent' },
        ],
      },
    });
    render(() => (
      <RoutineHistory
        {...source}
        records={[program]}
        isPending={false}
        describeStep={describeRunStep}
      />
    ));
    expect(source.createAgentMetadata).not.toHaveBeenCalled();
    const details = within(screen.getByRole('region', { name: 'Run details' }));
    expect(details.getByText('97%')).toBeTruthy();
    fireEvent.click(details.getByRole('button', { name: /Open conversation/ }));
    expect(source.onOpen).toHaveBeenCalledWith(
      { type: 'agent', id: 'program' },
      false
    );
  });

  it('returns from a chosen run to the list', () => {
    render(() => (
      <RoutineHistory
        {...sources()}
        records={[triage(), weekly('run-weekly')]}
        isPending={false}
        describeStep={describeRunStep}
      />
    ));
    fireEvent.click(within(row('CreateDocument')).getByRole('button'));
    expect(
      within(row('CreateDocument'))
        .getByRole('button')
        .getAttribute('aria-current')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(
      within(row('Chose Invoice'))
        .getByRole('button')
        .getAttribute('aria-current')
    ).toBe('true');
  });
});
