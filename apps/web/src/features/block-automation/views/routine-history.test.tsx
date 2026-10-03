import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createResource, createSignal, Suspense } from 'solid-js';
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
vi.mock('@entity', () => ({ formatDateAndTime: (value: string) => value }));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
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

function sources() {
  return {
    createChatMetadata: vi.fn(
      (id: string) => (): HistoryMetadata => ({
        status: 'ready',
        name: `Chat ${id}`,
      })
    ),
    createAgentMetadata: vi.fn(
      (id: string) => (): HistoryMetadata => ({
        status: 'ready',
        name: `Agent ${id}`,
      })
    ),
    onOpen: vi.fn(),
  };
}

function row(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name });
}

describe('routine history', () => {
  it('resolves mixed and legacy history from each result, not resource_id or current target', () => {
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
    fireEvent.click(screen.getByText('Chat chat'));
    fireEvent.click(screen.getByText('Agent session'), { shiftKey: true });
    fireEvent.click(screen.getByText('Chat legacy-error'), { shiftKey: true });
    expect(source.onOpen.mock.calls).toEqual([
      [{ type: 'chat', id: 'chat' }, false],
      [{ type: 'agent', id: 'session' }, true],
      [{ type: 'chat', id: 'legacy-error' }, true],
    ]);
  });

  it('preserves neutral synthetic rows and marks only persisted unsuccessful runs as failures', () => {
    render(() => (
      <RoutineHistory
        {...sources()}
        isPending={false}
        records={[
          record('agent', 'pending-agent', {
            id: undefined,
            is_success: false,
          }),
          record('chat', 'pending-chat', { id: null, is_success: false }),
          record('agent', 'failed-agent', { is_success: false }),
          record('chat', 'success'),
        ]}
      />
    ));
    for (const id of ['pending-agent', 'pending-chat', 'success']) {
      expect(
        screen.getByText(id).classList.contains('text-ink-extra-muted')
      ).toBe(true);
    }
    expect(
      screen.getByText('failed-agent').classList.contains('text-failure')
    ).toBe(true);
    fireEvent.click(screen.getByText('Agent pending-agent'));
    expect(row('Agent pending-agent pending-agent').disabled).toBe(false);
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
    'renders missing/unknown resources without queries or links: %j',
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
      expect(row('Run unavailable missing').disabled).toBe(true);
      fireEvent.click(screen.getByText('Run unavailable'));
      expect(source.onOpen).not.toHaveBeenCalled();
      expect(source.createChatMetadata).not.toHaveBeenCalled();
      expect(source.createAgentMetadata).not.toHaveBeenCalled();
      expect(
        screen.getByText('missing').classList.contains('text-failure')
      ).toBe(true);
    }
  );

  it('isolates metadata loading, unavailable resources, and empty titles', () => {
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
    expect(row('Loading… session').disabled).toBe(true);
    expect(row('Chat ready ready').disabled).toBe(false);
    setMetadata({ status: 'unavailable' });
    expect(row('Run unavailable session').disabled).toBe(true);
    fireEvent.click(screen.getByText('Run unavailable'));
    expect(source.onOpen).not.toHaveBeenCalled();
    setMetadata({ status: 'ready', name: '  ' });
    expect(row('Untitled run session').disabled).toBe(false);
  });

  it('catches a suspending metadata source at the row rather than detaching siblings', () => {
    const source = sources();
    source.createAgentMetadata.mockImplementation(() => {
      const [name] = createResource(() => new Promise<string>(() => {}));
      return () => ({ status: 'ready', name: name() ?? '' });
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
    expect(row('Loading… session').disabled).toBe(true);
    expect(row('Chat ready ready').disabled).toBe(false);
  });

  it('replaces a resource with the correct metadata source when a row changes', () => {
    const source = sources();
    const [records, setRecords] = createSignal([record('chat', 'first')]);
    render(() => (
      <RoutineHistory {...source} records={records()} isPending={false} />
    ));
    setRecords([record('agent', 'second')]);
    expect(screen.queryByText('Chat first')).toBeNull();
    fireEvent.click(screen.getByText('Agent second'));
    expect(source.onOpen).toHaveBeenCalledWith(
      { type: 'agent', id: 'second' },
      false
    );
  });

  it('keeps loading/empty states and the 50-row limit', () => {
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
      Array.from({ length: 51 }, (_, index) => record('chat', String(index)))
    );
    expect(screen.getAllByRole('button')).toHaveLength(50);
    expect(source.createChatMetadata).toHaveBeenCalledTimes(50);
  });
});
