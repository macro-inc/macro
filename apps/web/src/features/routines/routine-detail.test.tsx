import { toast } from '@core/component/Toast/Toast';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type Setter } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineTarget } from './core/routine-target';
import { Routine } from './routine-detail';
import type { HistoryRecord } from './views/routine-history';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 400, height: 80 }),
}));

vi.mock('@app/lib/split-router', () => ({
  createSearchParamsCodec: () => ({}),
  createSearchParams: () => {
    const [tab, setTab] = createSignal<'settings' | 'history'>('settings');
    return [
      {
        get tab() {
          return tab();
        },
      },
      (next: { tab: 'settings' | 'history' }) => setTab(next.tab),
    ];
  },
}));

const mocks = vi.hoisted(() => ({
  readSchedules: (): ScheduledAction[] => [],
  status: (): string => 'success',
  history: (): HistoryRecord[] => [],
  metadataStatus: (): string => 'success',
  chatMetadata: (): { chat?: { name: string } } | undefined => ({
    chat: { name: 'Run transcript' },
  }),
  agentMetadata: (): { name: string } | undefined => ({
    name: 'Agent transcript',
  }),
  chatQuery: vi.fn(),
  agentQuery: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
  setEnabled: vi.fn(),
  writeClipboardData: vi.fn(),
  activationPending: (): boolean => false,
  openWithSplit: vi.fn(),
  setDisplayName: vi.fn(),
  changePrompt: (_value: string): void => {},
  changeTarget: (_target: RoutineTarget): void => {},
  rename: (_value: string): void => {},
  duplicate: (): void => {},
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('./queries/routines', () => ({
  useRoutineQuery: () => ({
    get isSuccess() {
      return mocks.status() === 'success';
    },
    get isError() {
      return mocks.status() === 'error';
    },
    get isPending() {
      return mocks.status() === 'pending';
    },
    get data() {
      return mocks.readSchedules()[0];
    },
  }),
}));
vi.mock('./routine-triggers', () => ({
  RoutineTriggers: () => <div>Triggers</div>,
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'routine-id' }));
vi.mock('@core/component/AI/constant', () => ({
  DEFAULT_MODEL: 'claude-sonnet-4-6',
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: vi.fn(), success: vi.fn() },
}));
vi.mock('@core/util/dataTransfer', () => ({
  writeClipboardData: mocks.writeClipboardData,
}));
vi.mock('@entity', () => ({
  formatDateAndTime: (value: string) => value,
  ListLayoutProvider: (props: { children: JSX.Element }) => props.children,
  ListEntity: (props: {
    entity: { name: string };
    leadingAction: JSX.Element;
    onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  }) => (
    <button onClick={props.onClick}>
      {props.entity.name}
      {props.leadingAction}
    </button>
  ),
}));
vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openBulkEditModal: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: mocks.openWithSplit,
    replaceOrInsertSplit: vi.fn(),
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { setDisplayName: mocks.setDisplayName },
    setTitleFileMenuRef: vi.fn(),
  }),
  returnSplitToRecentListView: vi.fn(),
}));
vi.mock('@components/app/split-layout/components/HeaderIsland', () => ({
  HeaderIsland: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  SplitTitleFileMenu: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  BlockSplitFileMenu: (props: {
    tools: { label: string; action: () => void }[];
  }) => {
    mocks.duplicate =
      props.tools.find((tool) => tool.label === 'Duplicate')?.action ??
      (() => {});
    return (
      <>
        {props.tools.some((tool) => tool.label === 'Duplicate') && (
          <button onClick={mocks.duplicate}>Duplicate</button>
        )}
      </>
    );
  },
}));
vi.mock('./routine-prompt-editor', () => ({
  RoutinePromptEditor: (props: {
    initialValue: string;
    onChange: (value: string) => void;
  }) => {
    mocks.changePrompt = props.onChange;
    return (
      <textarea
        aria-label="Instructions"
        value={props.initialValue}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  },
}));
vi.mock('./routine-execution-picker', () => ({
  RoutineExecutionPicker: (props: {
    target: RoutineTarget;
    onChange: (target: RoutineTarget) => void;
  }) => {
    mocks.changeTarget = props.onChange;
    return (
      <output aria-label="Execution target">
        {JSON.stringify(props.target)}
      </output>
    );
  },
}));
vi.mock('@ui', async () => ({
  ...(await vi.importActual('@ui')),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  cn: (...classes: string[]) => classes.join(' '),
}));
vi.mock('@queries/chat', () => ({
  useChatQuery: (id: () => string) => {
    mocks.chatQuery(id());
    return {
      get isSuccess() {
        return mocks.metadataStatus() === 'success';
      },
      get isPending() {
        return mocks.metadataStatus() === 'pending';
      },
      get data() {
        return mocks.chatMetadata();
      },
    };
  },
}));
vi.mock('@queries/agent-session/session', () => ({
  useAgentSessionQuery: (id: () => string) => {
    mocks.agentQuery(id());
    return {
      get isSuccess() {
        return mocks.metadataStatus() === 'success';
      },
      get isPending() {
        return mocks.metadataStatus() === 'pending';
      },
      get data() {
        const metadata = mocks.agentMetadata();
        return metadata
          ? {
              ...metadata,
              ownerId: 'macro|owner@example.com',
              botId: 'test-bot',
              status: { kind: 'event', event: 'session/end' },
            }
          : undefined;
      },
    };
  },
}));
vi.mock('./queries/schedules', () => ({
  useSchedulesQuery: () => ({
    get data() {
      return mocks.readSchedules();
    },
    get isSuccess() {
      return mocks.status() === 'success';
    },
    get isPending() {
      return mocks.status() === 'pending';
    },
    get isError() {
      return mocks.status() === 'error';
    },
    get error() {
      return mocks.status() === 'error' ? new Error('Unavailable') : null;
    },
  }),
  useScheduleHistoryQuery: () => ({
    isSuccess: true,
    isPending: false,
    get data() {
      return mocks.history();
    },
  }),
  useUpdateScheduleMutation: () => ({ mutateAsync: mocks.update }),
  useCreateScheduleMutation: () => ({ mutate: mocks.create, isPending: false }),
  useRunScheduleNowMutation: () => ({ mutate: mocks.run, isPending: false }),
  useSetScheduleEnabledMutation: () => ({
    mutate: mocks.setEnabled,
    get isPending() {
      return mocks.activationPending();
    },
  }),
  invalidateSchedules: vi.fn(),
}));

const cron: ScheduledAction = {
  id: 'routine-id',
  owner: 'macro|owner@example.com',
  name: 'Summary',
  kind: 'Agent',
  trigger: {
    type: 'cron',
    schedule: '0 0 9 * * 2',
    timezone: 'America/New_York',
  },
  task: {
    model: 'claude-sonnet-4-6',
    user_prompt: 'Summarize updates',
    prompt: '',
  },
  enabled: true,
  configuration_revision: 1,
  created_at: '2026-09-22T12:00:00Z',
  updated_at: '2026-09-22T12:00:00Z',
  next_run_at: '2026-09-28T09:00:00Z',
};
const events: ScheduledAction = {
  ...cron,
  next_run_at: null,
  trigger: { type: 'events', filters: [{ events: ['document.updated'] }] },
};
let setSchedules: Setter<ScheduledAction[]>;
let setStatus: Setter<string>;
let setActivationPending: Setter<boolean>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockReset().mockResolvedValue(cron);
  mocks.writeClipboardData.mockReset().mockResolvedValue(true);
  vi.useFakeTimers();
  [mocks.status, setStatus] = createSignal('success');
  [mocks.readSchedules, setSchedules] = createSignal([cron]);
  [mocks.activationPending, setActivationPending] = createSignal(false);
  mocks.metadataStatus = () => 'success';
  mocks.chatMetadata = () => ({ chat: { name: 'Run transcript' } });
  mocks.agentMetadata = () => ({ name: 'Agent transcript' });
  mocks.history = () => [
    {
      id: 'run-id',
      resource_id: 'chat-id',
      result: null,
      start_time: '2026-09-22T12:00:00Z',
      is_success: true,
    },
  ];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const agentTarget: RoutineTarget = {
  kind: 'agent',
  agentId: '0195dbd2-6539-7000-8000-000000000001',
  modelOverride: 'runtime-model',
};

function openActions() {
  const trigger = screen.getByRole('button', { name: 'Routine actions' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

function runButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Run now' });
}

function openRunOptions() {
  const trigger = screen.getByRole('button', { name: 'Run options' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

function activationItem(): HTMLElement {
  const name = /^(Enable|Disable) routine$/;
  if (!screen.queryByRole('menuitem', { name })) openRunOptions();
  return screen.getByRole('menuitem', { name });
}

function selectedTarget(): RoutineTarget {
  return JSON.parse(screen.getByLabelText('Execution target').textContent!);
}

function deferredSave(): {
  promise: Promise<ScheduledAction>;
  resolve: (schedule: ScheduledAction) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (schedule: ScheduledAction) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ScheduledAction>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('routine execution target autosave', () => {
  it('copies the current prompt, including unsaved edits, from the run menu', async () => {
    render(() => <Routine />);
    mocks.changePrompt('Use my latest instructions');
    openRunOptions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy prompt' }), {
      key: 'Enter',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.writeClipboardData).toHaveBeenCalledExactlyOnceWith({
      'text/plain': 'Use my latest instructions',
    });
    expect(toast.success).toHaveBeenCalledWith('Prompt copied');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.queryByText('All changes saved')).toBeNull();
  });

  it('reports when the prompt could not be copied', async () => {
    mocks.writeClipboardData.mockResolvedValueOnce(false);
    render(() => <Routine />);
    openRunOptions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy prompt' }), {
      key: 'Enter',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.alert).toHaveBeenCalledWith('Could not copy prompt');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('initializes the stored agent and duplicates its full saved configuration', () => {
    const saved = {
      ...cron,
      task: {
        agent: { bot_id: agentTarget.agentId },
        model: 'runtime-model',
        prompt: 'System instructions',
        user_prompt: 'Task',
        extra: { retained: true },
      },
    };
    setSchedules([saved]);
    render(() => <Routine />);
    expect(selectedTarget()).toEqual(agentTarget);
    openActions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Duplicate' }), {
      key: 'Enter',
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ task: saved.task })
    );
  });

  it('disables immediate Run now until the latest target has saved', async () => {
    const save = deferredSave();
    mocks.update.mockReturnValueOnce(save.promise);
    render(() => <Routine />);
    mocks.changeTarget({ kind: 'model', model: 'first-choice' });
    mocks.changeTarget(agentTarget);
    expect(runButton().disabled).toBe(true);
    fireEvent.click(runButton());
    expect(mocks.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: cron.id,
      body: expect.objectContaining({
        task: {
          ...(cron.task as object),
          agent: { bot_id: agentTarget.agentId },
          model: 'runtime-model',
        },
      }),
    });
    expect(runButton().disabled).toBe(true);
    save.resolve(cron);
    await vi.advanceTimersByTimeAsync(0);
    expect(runButton().disabled).toBe(false);
    fireEvent.click(runButton());
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({ scheduleId: cron.id });
  });

  it('serializes slow saves and ignores stale responses/refetches for the displayed selection', async () => {
    const first = deferredSave();
    const last = deferredSave();
    mocks.update
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(last.promise);
    render(() => <Routine />);
    mocks.changeTarget(agentTarget);
    await vi.advanceTimersByTimeAsync(300);
    mocks.changeTarget({ kind: 'model', model: 'intermediate' });
    mocks.changeTarget({ kind: 'model', model: 'latest' });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const firstSaved = {
      ...cron,
      task: {
        ...(cron.task as object),
        agent: { bot_id: agentTarget.agentId },
        model: 'runtime-model',
      },
    };
    setSchedules([firstSaved]);
    first.resolve(firstSaved);
    await vi.advanceTimersByTimeAsync(0);
    expect(selectedTarget()).toEqual({ kind: 'model', model: 'latest' });
    expect(mocks.update).toHaveBeenLastCalledWith({
      scheduleId: cron.id,
      body: expect.objectContaining({
        task: expect.objectContaining({ agent: null, model: 'latest' }),
      }),
    });
    expect(runButton().disabled).toBe(true);
    last.resolve(cron);
    await vi.advanceTimersByTimeAsync(0);
    setSchedules([cron]);
    expect(selectedTarget()).toEqual({ kind: 'model', model: 'latest' });
    expect(runButton().disabled).toBe(false);
  });

  it('keeps a failed target visibly unsaved and blocks Run now until retry succeeds', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Agent unavailable'));
    render(() => <Routine />);
    mocks.changeTarget(agentTarget);
    await vi.advanceTimersByTimeAsync(300);
    expect(selectedTarget()).toEqual(agentTarget);
    expect(screen.getByRole('alert').textContent).toContain(
      'Changes not saved. Agent unavailable'
    );
    expect(runButton().disabled).toBe(true);
    fireEvent.click(runButton());
    expect(mocks.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Retry save'));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(runButton().disabled).toBe(false);
  });

  it('invalid edits cancel a queued valid save and keep Run now disabled', async () => {
    render(() => <Routine />);
    mocks.changeTarget(agentTarget);
    mocks.changePrompt('');
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(runButton().disabled).toBe(true);
  });

  it('pauses a routine with an invalid draft without saving the draft', async () => {
    render(() => <Routine />);
    mocks.changePrompt('');
    expect(screen.getByText('Instructions are required.')).toBeTruthy();
    fireEvent.keyDown(activationItem(), { key: 'Enter' });
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      enabled: false,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('keeps a queued target through a cached-data refetch error', async () => {
    render(() => <Routine />);
    mocks.changeTarget(agentTarget);
    setStatus('error');
    expect(selectedTarget()).toEqual(agentTarget);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledWith({
      scheduleId: cron.id,
      body: expect.objectContaining({
        task: expect.objectContaining({
          agent: { bot_id: agentTarget.agentId },
        }),
      }),
    });
  });

  it('pauses a running routine but blocks resuming until the run ends', () => {
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    const claimed = '2026-09-28T11:55:00Z';
    setSchedules([{ ...cron, claimed }]);
    render(() => <Routine />);
    expect(
      screen.getByText(/Configuration cannot be changed while running/)
    ).toBeTruthy();
    fireEvent.keyDown(activationItem(), { key: 'Enter' });
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      enabled: false,
    });
    setSchedules([{ ...cron, claimed, enabled: false }]);
    expect(activationItem().textContent).toContain('Enable routine');
    expect(activationItem().getAttribute('aria-disabled')).toBe('true');
    setSchedules([{ ...cron, enabled: false }]);
    expect(activationItem().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows a paused routine and still runs it on demand', async () => {
    render(() => <Routine />);
    expect(activationItem().textContent).toContain('Disable routine');
    expect(screen.getByText(/Next run/)).toBeTruthy();
    setSchedules([{ ...cron, enabled: false }]);
    expect(activationItem().textContent).toContain('Enable routine');
    expect(screen.getByText('Paused')).toBeTruthy();
    fireEvent.keyDown(activationItem(), { key: 'Escape' });
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(runButton());
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
    });
  });

  it('disables activation while a request is pending', () => {
    render(() => <Routine />);
    expect(activationItem().getAttribute('aria-disabled')).not.toBe('true');
    setActivationPending(true);
    expect(activationItem().getAttribute('aria-disabled')).toBe('true');
  });

  it.each(['unmount'])(
    'drops queued target changes on %s even during an in-flight save',
    async () => {
      const first = deferredSave();
      mocks.update.mockReturnValueOnce(first.promise);
      const { unmount } = render(() => <Routine />);
      mocks.changeTarget(agentTarget);
      await vi.advanceTimersByTimeAsync(300);
      mocks.changeTarget({ kind: 'model', model: 'queued' });
      unmount();
      first.resolve(cron);
      await vi.advanceTimersByTimeAsync(500);
      expect(mocks.update).toHaveBeenCalledTimes(1);
    }
  );
});

describe('routine history integration', () => {
  function mixedHistory(): void {
    const legacy = mocks.history();
    mocks.history = () => [
      ...legacy,
      {
        id: 'agent-run',
        resource_id: 'agent-id',
        result: { version: 1, resource: { type: 'agent', id: 'agent-id' } },
        start_time: '2026-09-23T12:00:00Z',
        is_success: false,
      },
    ];
  }

  it('keeps mixed history navigation stable while switching model to agent and back', async () => {
    mixedHistory();
    render(() => <Routine />);
    for (const target of [
      agentTarget,
      { kind: 'model', model: 'new-model' } satisfies RoutineTarget,
    ]) {
      mocks.changeTarget(target);
      await vi.advanceTimersByTimeAsync(300);
      const saved = mocks.update.mock.lastCall![0].body;
      setSchedules([{ ...cron, ...saved }]);
      fireEvent.click(screen.getByRole('tab', { name: 'Run History' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Run History' }));
      fireEvent.click(screen.getByText('Run transcript'));
      expect(mocks.openWithSplit).toHaveBeenLastCalledWith(
        { type: 'chat', id: 'chat-id' },
        { activate: true, preferNewSplit: false }
      );
      fireEvent.click(screen.getByText('Agent transcript'), { shiftKey: true });
      expect(mocks.openWithSplit).toHaveBeenLastCalledWith(
        { type: 'agent', id: 'agent-id' },
        { activate: true, preferNewSplit: true }
      );
    }
    expect(mocks.chatQuery.mock.calls.every(([id]) => id === 'chat-id')).toBe(
      true
    );
    expect(mocks.agentQuery.mock.calls.every(([id]) => id === 'agent-id')).toBe(
      true
    );
  });

  it.each(['pending', 'error'])(
    'never reads %s metadata or blanks the editor',
    (status) => {
      mixedHistory();
      mocks.metadataStatus = () => status;
      mocks.chatMetadata = () => {
        throw new Error('Unsafe chat data read');
      };
      mocks.agentMetadata = () => {
        throw new Error('Unsafe agent data read');
      };
      render(() => <Routine />);
      expect(
        screen.getByRole('textbox', { name: 'Instructions' })
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Run History' }));
      const labels = screen.getAllByText(
        status === 'pending' ? 'Loading…' : 'Run unavailable'
      );
      expect(labels).toHaveLength(2);
      for (const label of labels) fireEvent.click(label);
      expect(mocks.openWithSplit).not.toHaveBeenCalled();
    }
  );

  it('renders missing/deleted chat and agent metadata without invalid navigation', () => {
    mixedHistory();
    mocks.chatMetadata = () => ({});
    mocks.agentMetadata = () => undefined;
    render(() => <Routine />);
    fireEvent.click(screen.getByRole('tab', { name: 'Run History' }));
    const unavailable = screen.getAllByText('Run unavailable');
    expect(unavailable).toHaveLength(2);
    for (const label of unavailable) fireEvent.click(label);
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });
});

describe('routine editor triggers', () => {
  it('refreshes clean settings when a cached cron is replaced by an event configuration', async () => {
    render(() => <Routine />);
    setSchedules([{ ...events, configuration_revision: 2 }]);
    mocks.changePrompt('Keep the newer events');
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledWith({
      scheduleId: cron.id,
      body: expect.objectContaining({ trigger: events.trigger }),
    });
  });

  it('does not overwrite a newer remote trigger while a local edit is queued', async () => {
    render(() => <Routine />);
    mocks.changePrompt('Unsaved local instructions');
    setSchedules([{ ...events, configuration_revision: 2 }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      'changed elsewhere'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    expect(screen.queryByRole('alert')).toBeNull();
    mocks.changePrompt('Fresh event instructions');
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledWith({
      scheduleId: cron.id,
      body: expect.objectContaining({ trigger: events.trigger }),
    });
  });

  it('supports keyboard switching between settings and run history', async () => {
    render(() => <Routine />);
    const settings = screen.getByRole('tab', { name: 'Overview' });
    settings.focus();
    fireEvent.keyDown(settings, { key: 'ArrowRight' });
    await vi.advanceTimersByTimeAsync(300);
    const history = screen.getByRole('tab', { name: 'Run History' });
    expect(history.getAttribute('aria-selected')).toBe('true');
    expect(history.getAttribute('aria-controls')).toBe(
      screen.getByRole('tabpanel', { name: 'Run History' }).id
    );
    expect(screen.getByText('Run transcript')).toBeTruthy();
  });

  it('edits an event routine and retains its filters through autosave and refetch errors', async () => {
    setSchedules([events]);
    setStatus('error');
    render(() => <Routine />);
    const editor = screen.getByRole('textbox', { name: 'Instructions' });
    fireEvent.input(editor, { target: { value: 'New event instructions' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        trigger: events.trigger,
        task: expect.objectContaining({
          user_prompt: 'New event instructions',
        }),
      }),
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Run History' }));
    expect(screen.getByText('Run transcript')).toBeTruthy();
  });
  it('retains cron editing, duplication, run-now, and history navigation', async () => {
    render(() => <Routine />);
    fireEvent.input(screen.getByRole('textbox', { name: 'Instructions' }), {
      target: { value: 'New instructions' },
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: {
        name: 'Summary',
        kind: 'Agent',
        trigger: cron.trigger,
        task: {
          model: 'claude-sonnet-4-6',
          user_prompt: 'New instructions',
          prompt: '',
        },
      },
    });
    openActions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Duplicate' }), {
      key: 'Enter',
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      name: 'Summary copy',
      kind: 'Agent',
      enabled: true,
      task: cron.task,
      trigger: cron.trigger,
    });
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.click(screen.getByText('Run now'));
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Run History' }));
    fireEvent.click(screen.getByText('Run transcript'));
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'chat', id: 'chat-id' },
      { activate: true, preferNewSplit: false }
    );
  });

  it('cancels pending saves when the editor unmounts', async () => {
    const { unmount } = render(() => <Routine />);
    mocks.changePrompt('Unsaved');
    unmount();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not read pending resource data', () => {
    setStatus('pending');
    mocks.readSchedules = () => {
      throw new Error('Pending data read');
    };
    render(() => <Routine />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders a load error rather than spinning forever', () => {
    setStatus('error');
    setSchedules([]);
    render(() => <Routine />);
    expect(
      screen.getByText('Unable to load routine. Please try again.')
    ).toBeTruthy();
  });

  it('preserves the cron editor and queued save after a background refetch error', async () => {
    render(() => <Routine />);
    const editor = screen.getByRole('textbox', { name: 'Instructions' });
    fireEvent.input(editor, { target: { value: 'Queued during refetch' } });
    setStatus('error');
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    expect(screen.queryByText(/Unable to load routine/)).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        trigger: cron.trigger,
        task: expect.objectContaining({ user_prompt: 'Queued during refetch' }),
      }),
    });
  });

  it('initializes the editor from cached data even when mounted after a refetch error', () => {
    setStatus('error');
    render(() => <Routine />);
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBeTruthy();
  });

  it('distinguishes a missing action from a backend-managed event', () => {
    setSchedules([]);
    render(() => <Routine />);
    expect(screen.getByText('Routine not found.')).toBeTruthy();
  });
});
