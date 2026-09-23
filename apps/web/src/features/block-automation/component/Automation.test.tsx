import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, type Setter } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Automation } from './Automation';

const mocks = vi.hoisted(() => ({
  readSchedules: (): ScheduledAction[] => [],
  status: (): string => 'success',
  update: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
  openWithSplit: vi.fn(),
  setDisplayName: vi.fn(),
  changePrompt: (_value: string): void => {},
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
vi.mock('./AutomationTimePicker', () => ({ AutomationTimePicker: () => null }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  cn: (...classes: string[]) => classes.join(' '),
}));
vi.mock('@queries/chat', () => ({
  useChatQuery: () => ({ data: { chat: { name: 'Run transcript' } } }),
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
    data: [
      {
        id: 'run-id',
        resource_id: 'chat-id',
        start_time: '2026-09-22T12:00:00Z',
        is_success: true,
      },
    ],
  }),
  useUpdateScheduleMutation: () => ({ mutate: mocks.update }),
  useCreateScheduleMutation: () => ({ mutate: mocks.create, isPending: false }),
  useRunScheduleNowMutation: () => ({ mutate: mocks.run, isPending: false }),
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  [mocks.status, setStatus] = createSignal('success');
  [mocks.readSchedules, setSchedules] = createSignal([cron]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
        enabled: true,
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
