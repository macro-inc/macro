import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type Setter } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineTarget } from '../core/routine-target';
import type { HistoryRecord } from '../views/routine-history';
import { Automation } from './Automation';

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
  activationPending: (): boolean => false,
  openWithSplit: vi.fn(),
  setDisplayName: vi.fn(),
  changePrompt: (_value: string): void => {},
  changeTarget: (_target: RoutineTarget): void => {},
  rename: (_value: string): void => {},
  duplicate: (): void => {},
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'routine-id' }));
vi.mock('@core/component/AI/constant', () => ({
  DEFAULT_MODEL: 'claude-sonnet-4-6',
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New automation',
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: vi.fn(), success: vi.fn() },
}));
vi.mock('@entity', () => ({ formatDateAndTime: (value: string) => value }));
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
    mocks.duplicate = props.tools.find(
      (tool) => tool.label === 'Duplicate'
    )!.action;
    return <button onClick={mocks.duplicate}>Duplicate</button>;
  },
}));
vi.mock('./AutomationRenameModal', () => ({
  AutomationRenameModal: (props: { onRename: (value: string) => void }) => {
    mocks.rename = props.onRename;
    return null;
  },
}));
vi.mock('./AutomationPromptEditor', () => ({
  AutomationPromptEditor: (props: {
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
vi.mock('../routine-execution-picker', () => ({
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
vi.mock('./AutomationTimePicker', () => ({ AutomationTimePicker: () => null }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  cn: (...classes: string[]) => classes.join(' '),
  ToggleSwitch: (props: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-label={props.label}
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  ),
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
        return mocks.agentMetadata();
      },
    };
  },
}));
vi.mock('@queries/agent-schedule/schedules', () => ({
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

function runButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Run Now' });
}

function activeSwitch(): HTMLButtonElement {
  return screen.getByRole('switch', { name: 'Active' });
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

describe('automation execution target autosave', () => {
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
    render(() => <Automation />);
    expect(selectedTarget()).toEqual(agentTarget);
    fireEvent.click(screen.getByText('Duplicate'));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ task: saved.task })
    );
  });

  it('disables immediate Run Now until the latest target has saved', async () => {
    const save = deferredSave();
    mocks.update.mockReturnValueOnce(save.promise);
    render(() => <Automation />);
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
    render(() => <Automation />);
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

  it('keeps a failed target visibly unsaved and blocks Run Now until retry succeeds', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Agent unavailable'));
    render(() => <Automation />);
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

  it('invalid edits cancel a queued valid save and keep Run Now disabled', async () => {
    render(() => <Automation />);
    mocks.changeTarget(agentTarget);
    mocks.changePrompt('');
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(runButton().disabled).toBe(true);
  });

  it('pauses a routine with an invalid draft without saving the draft', async () => {
    render(() => <Automation />);
    mocks.changePrompt('');
    expect(screen.getByText('Prompt is required.')).toBeTruthy();
    fireEvent.click(activeSwitch());
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      enabled: false,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('keeps a queued target through a cached-data refetch error', async () => {
    render(() => <Automation />);
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
    render(() => <Automation />);
    expect(screen.getByText('Running')).toBeTruthy();
    fireEvent.click(activeSwitch());
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      enabled: false,
    });
    setSchedules([{ ...cron, claimed, enabled: false }]);
    expect(activeSwitch().getAttribute('aria-checked')).toBe('false');
    expect(activeSwitch().disabled).toBe(true);
    setSchedules([{ ...cron, enabled: false }]);
    expect(activeSwitch().disabled).toBe(false);
  });

  it('shows a paused routine switched off and still runs it on demand', () => {
    render(() => <Automation />);
    expect(activeSwitch().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Next run 2026-09-28T09:00:00Z')).toBeTruthy();
    setSchedules([{ ...cron, enabled: false }]);
    expect(activeSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/Next run/)).toBeNull();
    fireEvent.click(runButton());
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
    });
  });

  it('holds the switch while an activation request is pending', () => {
    render(() => <Automation />);
    expect(activeSwitch().disabled).toBe(false);
    setActivationPending(true);
    expect(activeSwitch().disabled).toBe(true);
  });

  it.each(['events', 'unmount'])(
    'drops queued target changes on %s even during an in-flight save',
    async (transition) => {
      const first = deferredSave();
      mocks.update.mockReturnValueOnce(first.promise);
      const { unmount } = render(() => <Automation />);
      mocks.changeTarget(agentTarget);
      await vi.advanceTimersByTimeAsync(300);
      mocks.changeTarget({ kind: 'model', model: 'queued' });
      if (transition === 'events') setSchedules([events]);
      else unmount();
      first.resolve(cron);
      await vi.advanceTimersByTimeAsync(500);
      expect(mocks.update).toHaveBeenCalledTimes(1);
    }
  );
});

describe('automation history integration', () => {
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
    render(() => <Automation />);
    for (const target of [
      agentTarget,
      { kind: 'model', model: 'new-model' } satisfies RoutineTarget,
    ]) {
      mocks.changeTarget(target);
      await vi.advanceTimersByTimeAsync(300);
      const saved = mocks.update.mock.lastCall![0].body;
      setSchedules([{ ...cron, ...saved }]);
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
      render(() => <Automation />);
      expect(
        screen.getByRole('textbox', { name: 'Instructions' })
      ).toBeTruthy();
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
    render(() => <Automation />);
    const unavailable = screen.getAllByText('Run unavailable');
    expect(unavailable).toHaveLength(2);
    for (const label of unavailable) fireEvent.click(label);
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });
});

describe('automation editor trigger guards', () => {
  it('shows an explicit backend-managed state on a direct event route', async () => {
    setSchedules([events]);
    render(() => <Automation />);
    expect(screen.getByText('Backend-managed routine')).toBeTruthy();
    expect(
      screen.getByText(/Manage this routine through the API/)
    ).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('Duplicate')).toBeNull();
    expect(screen.queryByText('Run Now')).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('retains cron editing, duplication, run-now, and history navigation', async () => {
    render(() => <Automation />);
    expect(screen.getByText(/America\/New_York/)).toBeTruthy();
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
    fireEvent.click(screen.getByText('Duplicate'));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      name: 'Summary copy',
      kind: 'Agent',
      enabled: true,
      task: cron.task,
      trigger: cron.trigger,
    });
    fireEvent.click(screen.getByText('Run Now'));
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
    });
    fireEvent.click(screen.getByText('Run transcript'));
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'chat', id: 'chat-id' },
      { activate: true, preferNewSplit: false }
    );
  });

  it('blocks queued autosave and stale edit/duplicate callbacks after a trigger changes to events', async () => {
    render(() => <Automation />);
    mocks.changePrompt('Queued edit');
    setSchedules([events]);
    expect(screen.getByText('Backend-managed routine')).toBeTruthy();
    mocks.rename('Stale rename');
    mocks.changePrompt('Stale prompt');
    mocks.duplicate();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.setDisplayName).not.toHaveBeenCalledWith('Stale rename');
  });

  it('does not resurrect queued saves when returning from an event to a cron action', async () => {
    render(() => <Automation />);
    mocks.changeTarget(agentTarget);
    setSchedules([events]);
    setSchedules([cron]);
    expect(selectedTarget()).toEqual({
      kind: 'model',
      model: 'claude-sonnet-4-6',
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('cancels pending saves when the editor unmounts', async () => {
    const { unmount } = render(() => <Automation />);
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
    render(() => <Automation />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders a load error rather than spinning forever', () => {
    setStatus('error');
    setSchedules([]);
    render(() => <Automation />);
    expect(
      screen.getByText('Unable to load automation. Please try again.')
    ).toBeTruthy();
  });

  it('preserves the cron editor and queued save after a background refetch error', async () => {
    render(() => <Automation />);
    const editor = screen.getByRole('textbox', { name: 'Instructions' });
    fireEvent.input(editor, { target: { value: 'Queued during refetch' } });
    setStatus('error');
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    expect(screen.queryByText(/Unable to load automation/)).toBeNull();
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
    render(() => <Automation />);
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBeTruthy();
  });

  it('keeps cached event routines backend-managed after a refetch error', async () => {
    render(() => <Automation />);
    mocks.changePrompt('Queued edit');
    setSchedules([events]);
    setStatus('error');
    expect(screen.getByText('Backend-managed routine')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    mocks.rename('Stale rename');
    mocks.duplicate();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('distinguishes a missing action from a backend-managed event', () => {
    setSchedules([]);
    render(() => <Automation />);
    expect(screen.getByText('Automation not found.')).toBeTruthy();
  });
});
