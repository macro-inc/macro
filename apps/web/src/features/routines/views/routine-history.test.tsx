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
import type { HistoryStep } from '../core/history';
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
      // A run that failed before any step opens its reason beside the list;
      // the others lost their transcript and open nothing.
      const reason = screen.queryByRole('region', { name: 'Run details' });
      if (reason) {
        expect(within(reason).getByRole('alert').textContent).toContain(
          'Preparation failed'
        );
      } else {
        fireEvent.click(screen.getByText('Run unavailable'));
        expect(screen.queryByRole('button')).toBeNull();
      }
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
  const code = (path: string, error?: string) => ({
    path,
    kind: 'code' as const,
    calls: [],
    calls_truncated: false,
    ...(error ? { error } : {}),
  });
  function triage() {
    return toHistoryRecord({
      id: 'run-steps',
      result: {
        version: 1,
        resource: null,
        error: 'Post the update failed: No access',
        steps: [code('0'), code('1', 'No access')],
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
        steps: [code('0'), { path: '1', kind: 'agent' }],
      },
      start_time: '2026-10-08T10:00:00Z',
      is_success: true,
    });
  }
  const TITLES: Record<string, string> = {
    'run-steps:0': 'Label invoices',
    'run-steps:1': 'Post the update',
    'run-weekly:0': 'Find stuck tasks',
  };
  const describeRunStep = (step: HistoryStep, record: HistoryRecord) =>
    step.kind === 'code'
      ? `${TITLES[`${record.id}:${step.path}`] ?? 'Ran code'}${step.error ? ` failed: ${step.error}` : ''}`
      : 'Asked AI';

  it('opens why a run failed before any step', () => {
    const reason = 'The item that triggered this routine couldn’t be read.';
    const failed = toHistoryRecord({
      id: 'run-failed',
      result: { version: 1, resource: null, error: reason },
      start_time: '2026-10-09T10:00:00Z',
      end_time: '2026-10-09T10:00:01Z',
      is_success: false,
    });
    render(() => (
      <RoutineHistory
        {...sources()}
        records={[failed, weekly('run-weekly')]}
        isPending={false}
        describeStep={describeRunStep}
      />
    ));
    fireEvent.click(within(row('Run failed')).getByRole('button'));
    // The row truncates the reason; the details read it in full.
    const details = within(screen.getByRole('region', { name: 'Run details' }));
    expect(details.getByRole('alert').textContent).toContain(reason);
  });

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
    const run = within(row('Label invoices'));
    expect(
      run.getByText('Post the update failed: No access').className
    ).toContain('text-failure');
    expect(within(row('Find stuck tasks')).getByText('Asked AI')).toBeTruthy();

    const details = within(screen.getByRole('region', { name: 'Run details' }));
    expect(
      details.getByRole('heading', { name: 'Label invoices' })
    ).toBeTruthy();
    expect(details.getByText(/^.*Failed · took 3\.0 s$/)).toBeTruthy();
    expect(details.getByText('No access').className).toContain('text-failure');

    fireEvent.click(within(row('Find stuck tasks')).getByRole('button'));
    expect(
      details.queryByRole('heading', { name: 'Label invoices' })
    ).toBeNull();
    expect(details.getByText(/1 AI call/)).toBeTruthy();

    // A run that only asked its agent opens the conversation instead.
    fireEvent.click(within(row('Agent agent-run')).getByRole('button'));
    expect(source.onOpen).toHaveBeenCalledWith(
      { type: 'agent', id: 'agent-run' },
      false
    );
  });

  it('says what started a run and shows each step’s output on request', () => {
    const onOpenItem = vi.fn();
    const run = toHistoryRecord({
      id: 'run-code',
      result: {
        version: 1,
        resource: null,
        steps: [{ path: '0', kind: 'code', output: { important: 3 } }],
        run: {
          at: '2026-11-01T09:00:00Z',
          started_by: {
            kind: 'event',
            event: 'email.message_received',
            entity_id: 'thread-1',
          },
        },
      },
      start_time: '2026-11-01T09:00:00Z',
      is_success: true,
    });
    render(() => (
      <RoutineHistory
        {...sources()}
        records={[run]}
        isPending={false}
        describeStep={() => 'Triaged'}
        describeStart={() => 'New email received · first run'}
        onOpenItem={onOpenItem}
      />
    ));
    const details = within(screen.getByRole('region', { name: 'Run details' }));
    expect(details.getByText('New email received · first run')).toBeTruthy();
    fireEvent.click(details.getByRole('button', { name: 'Open item' }));
    expect(onOpenItem).toHaveBeenCalledWith(
      { block: 'email', id: 'thread-1' },
      false
    );
    // Outputs stay collapsed until asked for.
    expect(details.queryByText(/"important": 3/)).toBeNull();
    const toggle = details.getByRole('button', { name: 'Show output' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(details.getByText(/"important": 3/)).toBeTruthy();
  });

  it('says whom a run’s code acted as, only when it ran code', () => {
    const run = (steps: object[], codeActsAs?: string) =>
      toHistoryRecord({
        id: `run-${codeActsAs}-${steps.length}`,
        result: {
          version: 1,
          resource: null,
          steps,
          run: {
            at: '2026-11-01T09:00:00Z',
            started_by: { kind: 'manual', by: 'macro|owner@example.com' },
            ...(codeActsAs ? { code_acts_as: codeActsAs } : {}),
          },
        },
        start_time: '2026-11-01T09:00:00Z',
        is_success: true,
      });
    const code = { path: '0', kind: 'code' };
    const details = (record: HistoryRecord) => {
      cleanup();
      render(() => (
        <RoutineHistory
          {...sources()}
          records={[record]}
          isPending={false}
          describeStep={() => 'Posted'}
        />
      ));
      // A run that only asked AI opens its conversation instead of details.
      return (
        screen.queryByRole('region', { name: 'Run details' })?.textContent ?? ''
      );
    };
    expect(details(run([code], 'owner'))).toContain('Code acted as you');
    expect(details(run([code], 'agent'))).toContain('Code acted as the agent');
    // Older runs, runs without code, and unknown values say nothing.
    expect(details(run([code]))).not.toContain('Code acted as');
    expect(details(run([{ path: '0', kind: 'agent' }], 'owner'))).not.toContain(
      'Code acted as'
    );
    expect(details(run([code], 'someone'))).not.toContain('Code acted as');
  });

  it('opens an agent step’s conversation from the run', () => {
    const source = sources();
    const program = record('agent', 'program', {
      result: {
        version: 1,
        resource: { type: 'agent', id: 'program' },
        steps: [code('0'), { path: '1', kind: 'agent' }],
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
    fireEvent.click(within(row('Find stuck tasks')).getByRole('button'));
    expect(
      within(row('Find stuck tasks'))
        .getByRole('button')
        .getAttribute('aria-current')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(
      within(row('Label invoices'))
        .getByRole('button')
        .getAttribute('aria-current')
    ).toBe('true');
  });
});
