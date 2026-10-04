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
import {
  type HistoryMetadata,
  type HistoryRecord,
  RoutineHistory,
} from './routine-history';

vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <span data-icon={props.targetType} />
  ),
}));
vi.mock('@entity', () => ({
  formatDateAndTime: (value: string) => value,
  ListLayoutProvider: (props: { children: JSX.Element }) => props.children,
  ListEntity: (props: {
    entity: AgentSessionEntity | ChatEntity;
    leadingAction: JSX.Element;
    onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  }) => (
    <button data-entity-type={props.entity.type} onClick={props.onClick}>
      {props.entity.name}
      {props.leadingAction}
      <time>{String(props.entity.sortTs ?? '')}</time>
    </button>
  ),
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
  overrides: Partial<HistoryRecord> = {}
): HistoryRecord {
  return {
    id: `run-${id}`,
    resource_id: id,
    result: { version: 1, resource: { type, id } },
    start_time: id,
    is_success: true,
    ...overrides,
  };
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

describe('routine history', () => {
  it('uses Soup entities and resolves agent and legacy resources from each result', () => {
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
    const session = screen.getByRole('listitem', { name: 'Agent session' });
    expect(
      session.querySelector('[data-entity-type="agent_session"]')
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Chat chat/ }));
    fireEvent.keyDown(session, { key: 'Enter', shiftKey: true });
    fireEvent.click(
      screen.getByRole('button', { name: /^Chat legacy-error/ }),
      { shiftKey: true }
    );
    expect(source.onOpen.mock.calls).toEqual([
      [{ type: 'chat', id: 'chat' }, false],
      [{ type: 'agent', id: 'session' }, true],
      [{ type: 'chat', id: 'legacy-error' }, true],
    ]);
  });

  it('keeps live runs neutral, shows failures, and includes execution duration', () => {
    render(() => (
      <RoutineHistory
        {...sources()}
        isPending={false}
        records={[
          record('agent', 'pending', { id: undefined, is_success: false }),
          record('agent', 'failed', { is_success: false }),
          record('agent', 'success', {
            start_time: '2026-10-04T12:00:00Z',
            end_time: '2026-10-04T12:01:12Z',
          }),
        ]}
      />
    ));
    expect(
      within(screen.getByRole('listitem', { name: 'Agent pending' }))
        .getByText('Running')
        .classList.contains('text-failure')
    ).toBe(false);
    expect(
      within(screen.getByRole('listitem', { name: 'Agent failed' }))
        .getByText('Failed')
        .classList.contains('text-failure')
    ).toBe(true);
    expect(
      within(screen.getByRole('listitem', { name: 'Agent success' })).getByText(
        '1m 12s'
      )
    ).toBeTruthy();
    expect(
      within(screen.getByRole('listitem', { name: 'Agent success' })).getByText(
        '2026-10-04T12:00:00Z'
      )
    ).toBeTruthy();
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
      fireEvent.click(screen.getByText('Run unavailable'));
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
    expect(screen.getByRole('listitem', { name: 'Chat ready' })).toBeTruthy();
    setMetadata({ status: 'unavailable' });
    fireEvent.click(screen.getByText('Run unavailable'));
    expect(source.onOpen).not.toHaveBeenCalled();
    setMetadata({ status: 'ready', entity: entity('agent', 'session', '  ') });
    expect(screen.getByRole('listitem', { name: 'Untitled run' })).toBeTruthy();
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
    expect(screen.getByRole('listitem', { name: 'Chat ready' })).toBeTruthy();
  });

  it('replaces a resource with the correct metadata source when records change', () => {
    const source = sources();
    const [records, setRecords] = createSignal([record('chat', 'first')]);
    render(() => (
      <RoutineHistory {...source} records={records()} isPending={false} />
    ));
    setRecords([record('agent', 'second')]);
    expect(screen.queryByRole('listitem', { name: 'Chat first' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Agent second/ }));
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
});
