import { beginInteraction, usePending } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import {
  NOOP_SPAN,
  type Span,
  type TraceContext,
} from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type {
  CodeUpgrade,
  RoutineTask,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  type Setter,
  untrack,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineTarget } from './core/routine-target';
import { scheduledActionKeys } from './queries/keys';
import { Routine } from './routine-detail';
import type { HistoryRecord } from './views/routine-history';

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
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
  openChat: vi.fn(async (_input: string) => {}),
  status: (): string => 'success',
  listStatus: (): string => 'success',
  refetchList: vi.fn(async () => {}),
  history: (): HistoryRecord[] => [],
  codeUpgrades: (): CodeUpgrade[] => [],
  refetchUpgrades: vi.fn(async () => {}),
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
  updateTrace: vi.fn<(parentSpan?: TraceContext) => void>(),
  create: vi.fn(),
  run: vi.fn(),
  setEnabled: vi.fn(),
  activationTrace: vi.fn<(parentSpan?: TraceContext) => void>(),
  writeClipboardData: vi.fn(),
  activationPending: (): boolean => false,
  openWithSplit: vi.fn(),
  setDisplayName: vi.fn(),
  changePrompt: (_value: string): void => {},
  changeTarget: (_target: RoutineTarget): void => {},
  rename: (_value: string): void => {},
  duplicate: (): void => {},
  sharing: (): boolean => false,
  subRoutineWrites: (): boolean => true,
  eventWrites: (): boolean => true,
  shared: (): boolean => false,
  templateError: (): boolean => false,
  readSharingStatus: vi.fn(),
  refetchTemplate: vi.fn(async () => {}),
  stopSharing: vi.fn(),
  detach: vi.fn(),
  connectedApps: (): ReadonlySet<string> | undefined => new Set(),
  realRoutineQuery: false,
  getRoutine: vi.fn(),
  agentsPending: (): boolean => false,
  agentsFailed: (): boolean => false,
  agentHarness: (): string => 'macrod',
}));
vi.mock('@app/observability/flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/observability/flow')>()),
  usePending: vi.fn(),
  beginInteraction: vi.fn(() => ({
    span: NOOP_SPAN,
    hold: () => vi.fn(),
    end: vi.fn(),
  })),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('@service-scheduled-action/client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@service-scheduled-action/client')>();
  return {
    ...actual,
    scheduledActionClient: {
      ...actual.scheduledActionClient,
      getRoutine: mocks.getRoutine,
    },
  };
});
vi.mock('./queries/routines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries/routines')>();
  return {
    ...actual,
    readFreshRoutine: (id: string, parent: TraceContext) =>
      mocks.realRoutineQuery
        ? actual.readFreshRoutine(id, parent)
        : Promise.resolve(mocks.readSchedules()[0]),
    useRoutineQuery: (id: Accessor<string>) =>
      mocks.realRoutineQuery
        ? actual.useRoutineQuery(id)
        : {
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
          },
  };
});
vi.mock('./routine-triggers', () => ({
  RoutineTriggers: () => <div>Triggers</div>,
}));
vi.mock('./routine-template', () => ({
  RoutineTemplatePage: (props: { scheduleId: string }) => (
    <div>Template for {props.scheduleId}</div>
  ),
  openShareRoutineDialog: vi.fn(),
}));
vi.mock('./queries/templates', () => ({
  readRoutineTemplateStatus: async (id: string, parent: TraceContext) => {
    mocks.readSharingStatus(id, parent);
  },
  useRoutineTemplateQuery: (
    id: Accessor<string>,
    enabled: Accessor<boolean>
  ) => {
    createEffect(() => {
      if (enabled()) mocks.readSharingStatus(id());
    });
    return {
      refetch: mocks.refetchTemplate,
      get isSuccess() {
        return mocks.shared() && !mocks.templateError();
      },
      get isError() {
        return mocks.templateError();
      },
      get data() {
        return mocks.shared() ? { id: 'routine-id' } : null;
      },
    };
  },
  useUnshareTemplateMutation: () => ({
    mutateAsync: mocks.stopSharing,
    isPending: false,
  }),
}));
vi.mock('@core/block', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/block')>()),
  useBlockId: () => 'routine-id',
}));
vi.mock('@core/component/AI/constant', () => ({
  DEFAULT_MODEL: 'claude-sonnet-4-6',
  defaultModelForPlan: () => 'claude-sonnet-4-6',
}));
vi.mock('@core/auth/license', () => ({ useHasPaidAccess: () => () => true }));
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
  useSplitPanel: () => undefined,
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
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-sub-routines'
        ? mocks.subRoutineWrites()
        : flag.key === 'enable-event-routines'
          ? mocks.eventWrites()
          : mocks.sharing(),
  }),
}));
vi.mock('./routine-ai-composer', () => ({
  RoutineAiComposer: () => null,
  useComposerContext: () => () => ({}),
}));
vi.mock('@queries/storage/system-skills', () => ({
  useSystemSkillsQuery: () => ({
    skills: () => [{ id: 'compose-skill-id', name: 'Compose Routines' }],
  }),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  openChatWithInput: mocks.openChat,
}));
vi.mock('./routine-step-pickers', () => ({
  routineToolSlots: {
    LabelPicker: () => null,
    TagPicker: () => null,
    ChannelPicker: () => null,
    AssigneePicker: () => null,
    FolderPicker: () => null,
  },
}));
vi.mock('./routine-prompt-editor', () => ({
  RoutinePromptEditor: (props: {
    initialValue: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => {
    mocks.changePrompt = props.onChange;
    // Like the real editor, read the initial value only once.
    const initialValue = untrack(() => props.initialValue);
    return (
      <textarea
        aria-label="Instructions"
        disabled={props.disabled}
        value={initialValue}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  },
}));
vi.mock('./routine-apps', () => ({
  RoutineApps: () => null,
}));
vi.mock('./queries/connected-apps', () => ({
  createRoutineConnectedApps: () => () => mocks.connectedApps(),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    get isPending() {
      return mocks.agentsPending();
    },
    get isError() {
      return mocks.agentsFailed();
    },
    get data() {
      if (mocks.agentsPending()) throw new Error('Read pending agents');
      if (mocks.agentsFailed()) return undefined;
      return [
        {
          bot: { id: '12345678-1234-1234-1234-123456789abc' },
          harness: mocks.agentHarness(),
        },
      ];
    },
  }),
}));
vi.mock('./routine-execution-picker', () => ({
  RoutineExecutionPicker: (props: {
    target: RoutineTarget;
    onChange: (target: RoutineTarget) => void;
  }) => {
    mocks.changeTarget = props.onChange;
    return (
      <button
        type="button"
        aria-label="Execution target"
        onClick={() =>
          props.onChange({ kind: 'model', model: 'claude-sonnet-4-6' })
        }
      >
        {JSON.stringify(props.target)}
      </button>
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
    refetch: mocks.refetchList,
    get data() {
      return mocks.readSchedules();
    },
    get isSuccess() {
      return (mocks.listStatus() || mocks.status()) === 'success';
    },
    get isPending() {
      return (mocks.listStatus() || mocks.status()) === 'pending';
    },
    get isLoading() {
      return (mocks.listStatus() || mocks.status()) === 'pending';
    },
    get isError() {
      return (mocks.listStatus() || mocks.status()) === 'error';
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
  useCodeUpgradesQuery: () => ({
    isSuccess: true,
    isPending: false,
    get data() {
      return mocks.codeUpgrades();
    },
    refetch: mocks.refetchUpgrades,
  }),
  useChildrenQuery: () => ({ isSuccess: true, data: [] }),
  useDetachScheduleMutation: () => ({
    mutateAsync: mocks.detach,
    isPending: false,
  }),
  useUpdateScheduleMutation: () => ({
    mutateAsync: ({
      parentSpan,
      ...args
    }: {
      scheduleId: string;
      body: unknown;
      parentSpan?: TraceContext;
    }) => {
      mocks.updateTrace(parentSpan);
      return mocks.update(args);
    },
  }),
  useCreateScheduleMutation: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useRunScheduleNowMutation: () => ({ mutate: mocks.run, isPending: false }),
  useSetScheduleEnabledMutation: () => ({
    mutate: mocks.setEnabled,
    mutateAsync: ({
      parentSpan,
      ...args
    }: {
      scheduleId: string;
      enabled: boolean;
      parentSpan?: TraceContext;
    }) => {
      mocks.activationTrace(parentSpan);
      return mocks.setEnabled(args);
    },
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
  run_visibility: 'unlisted',
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
let setListStatus: Setter<string>;
let setActivationPending: Setter<boolean>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  mocks.update.mockReset().mockResolvedValue(cron);
  mocks.writeClipboardData.mockReset().mockResolvedValue(true);
  vi.useFakeTimers();
  [mocks.status, setStatus] = createSignal('success');
  [mocks.listStatus, setListStatus] = createSignal('');
  [mocks.readSchedules, setSchedules] = createSignal([cron]);
  [mocks.activationPending, setActivationPending] = createSignal(false);
  mocks.metadataStatus = () => 'success';
  mocks.chatMetadata = () => ({ chat: { name: 'Run transcript' } });
  mocks.agentMetadata = () => ({ name: 'Agent transcript' });
  mocks.codeUpgrades = () => [];
  mocks.sharing = () => false;
  mocks.subRoutineWrites = () => true;
  mocks.eventWrites = () => true;
  mocks.shared = () => false;
  mocks.templateError = () => false;
  mocks.connectedApps = () => new Set();
  mocks.realRoutineQuery = false;
  mocks.agentsPending = () => false;
  mocks.agentsFailed = () => false;
  mocks.agentHarness = () => 'macrod';
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
  vi.unstubAllGlobals();
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
  const name = /^Turn (on|off)$/;
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
  it('shows another owner’s routine as its template, without its controls', () => {
    setSchedules([{ ...cron, owner: 'macro|someone-else@example.com' }]);
    render(() => <Routine />);
    expect(screen.getByText('Template for routine-id')).toBeTruthy();
    expect(screen.queryByLabelText('Instructions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Routine actions' })
    ).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Runs' })).toBeNull();
    mocks.changePrompt('Changed');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('copies the current prompt, including unsaved edits, from the run menu', async () => {
    render(() => <Routine />);
    mocks.changePrompt('Use my latest instructions');
    openRunOptions();
    await vi.advanceTimersByTimeAsync(0);
    const copyItem = screen.getByRole('menuitem', { name: 'Copy prompt' });
    copyItem.focus();
    fireEvent.keyDown(copyItem, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.writeClipboardData).toHaveBeenCalledExactlyOnceWith({
      'text/plain': 'Use my latest instructions',
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Copy prompt' })).toBe(
      document.activeElement
    );
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
    expect(mocks.create).toHaveBeenCalledWith({
      body: expect.objectContaining({ task: saved.task }),
      parentSpan: NOOP_SPAN,
    });
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
        user_prompt: 'Summarize updates',
        prompt: '',
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
    expect(activationItem().textContent).toContain('Turn on');
    expect(activationItem().getAttribute('aria-disabled')).toBe('true');
    setSchedules([{ ...cron, enabled: false }]);
    expect(activationItem().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows a paused routine and still runs it on demand', async () => {
    render(() => <Routine />);
    expect(activationItem().textContent).toContain('Turn off');
    expect(screen.getByText(/Next run/)).toBeTruthy();
    setSchedules([{ ...cron, enabled: false }]);
    expect(activationItem().textContent).toContain('Turn on');
    expect(screen.getByText('Next run: Paused')).toBeTruthy();
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
      fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
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
      fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
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
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
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

  it('refreshes clean settings rewritten on the server at the same revision', async () => {
    render(() => <Routine />);
    // A code upgrade changes the configuration but keeps its revision.
    setSchedules([{ ...cron, name: 'Rewritten elsewhere' }]);
    mocks.changePrompt('Edit after the rewrite');
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledWith({
      scheduleId: cron.id,
      body: expect.objectContaining({ name: 'Rewritten elsewhere' }),
    });
  });

  it('does not overwrite a same-revision rewrite while a local edit is queued', async () => {
    render(() => <Routine />);
    mocks.changePrompt('Unsaved local instructions');
    setSchedules([{ ...cron, name: 'Rewritten elsewhere' }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      'changed elsewhere'
    );
  });

  it('supports keyboard switching between settings and run history', async () => {
    render(() => <Routine />);
    const settings = screen.getByRole('tab', { name: 'Overview' });
    settings.focus();
    fireEvent.keyDown(settings, { key: 'ArrowRight' });
    await vi.advanceTimersByTimeAsync(300);
    const history = screen.getByRole('tab', { name: 'Runs' });
    expect(history.getAttribute('aria-selected')).toBe('true');
    expect(history.getAttribute('aria-controls')).toBe(
      screen.getByRole('tabpanel', { name: 'Runs' }).id
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
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
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
        run_visibility: 'unlisted',
      },
    });
    openActions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Duplicate' }), {
      key: 'Enter',
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      parentSpan: NOOP_SPAN,
      body: {
        name: 'Summary copy',
        kind: 'Agent',
        enabled: true,
        task: cron.task,
        trigger: cron.trigger,
        run_visibility: 'unlisted',
      },
    });
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.click(screen.getByText('Run now'));
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    fireEvent.click(screen.getByText('Run transcript'));
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'chat', id: 'chat-id' },
      { activate: true, preferNewSplit: false }
    );
  });

  it('turns the routine on and off beside its title', () => {
    render(() => <Routine />);
    const enabled = screen.getByRole('switch', { name: 'Enabled' });
    expect((enabled as HTMLInputElement).checked).toBe(true);
    fireEvent.click(enabled);
    expect(mocks.setEnabled).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      enabled: false,
    });
    // An Ask AI routine lists the apps it can use on the page.
    expect(
      within(screen.getByRole('region', { name: 'Connections' })).getByText(
        'No connections added'
      )
    ).toBeTruthy();
  });

  it('saves whether the routine’s runs show in Home and Agents', async () => {
    render(() => <Routine />);
    // Runs & notifications sits on the page, below the steps.
    const visibility = screen.getByRole('switch', {
      name: 'Show runs in Home and Agents',
    });
    expect((visibility as HTMLInputElement).checked).toBe(false);
    fireEvent.click(visibility);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        task: cron.task,
        run_visibility: 'listed',
      }),
    });
  });

  it('offers acting as the owner only for routines with code, off by default', async () => {
    render(() => <Routine />);
    // An Ask AI routine stays the agent's, so there is nothing to choose.
    expect(screen.queryByRole('switch', { name: 'Act as me' })).toBeNull();
    cleanup();

    const task: RoutineTask = {
      steps: [
        {
          type: 'code',
          title: 'Post the summary',
          source: 'export async function main() {}',
        },
      ],
    };
    const program: ScheduledAction = { ...events, task };
    setSchedules([program]);
    render(() => <Routine />);
    const actAsMe = screen.getByRole('switch', { name: 'Act as me' });
    expect((actAsMe as HTMLInputElement).checked).toBe(false);
    expect(
      screen.getByText(
        'Posts, emails and comments from code steps will appear as written by you, with no Agent badge.'
      )
    ).toBeTruthy();
    fireEvent.click(actAsMe);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        task: { ...task, dangerously_operate_as_user: true },
      }),
    });
  });

  it('saves a description typed under the title, on blur', async () => {
    render(() => <Routine />);
    const description = screen.getByRole('textbox', {
      name: 'Routine description',
    });
    fireEvent.input(description, {
      target: { value: '  Sum up my day before standup.  ' },
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.blur(description);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        task: cron.task,
        description: 'Sum up my day before standup.',
      }),
    });
  });

  it('composes with an agent: the routine and its skill in a new conversation', () => {
    render(() => <Routine />);
    fireEvent.click(screen.getByRole('button', { name: 'Compose with agent' }));
    expect(mocks.openChat).toHaveBeenCalledOnce();
    const input = mocks.openChat.mock.calls[0]?.[0] ?? '';
    expect(input).toContain('compose-skill-id');
    expect(input).toContain('routine-id');
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

describe('routine code that needs an update', () => {
  const code = (source: string, sdk: string): RoutineTask => ({
    steps: [{ type: 'code', title: 'File invoices', source }],
    sdk,
  });
  const paused: ScheduledAction = {
    ...cron,
    enabled: false,
    task: code('macro.tasks.create(x)', '0.2.0+old'),
  };
  const upgrade = (task?: RoutineTask): CodeUpgrade => ({
    id: 'upgrade',
    fromSdk: '0.2.0+old',
    toSdk: '0.3.0+new',
    outcome: 'needs_update',
    reason: '“File invoices” failed a dry run.',
    previousTask: paused.task,
    task,
    createdAt: '2026-11-01T09:00:00Z',
    updatedAt: '2026-11-01T09:00:00Z',
  });

  it.each(['missing connection', 'external target'])(
    'blocks approval for a %s already found by the form',
    (problem) => {
      const agent =
        problem === 'external target'
          ? {
              type: 'agent' as const,
              agent: { bot_id: '12345678-1234-1234-1234-123456789abc' },
              instructions: 'Check the task',
            }
          : {
              type: 'agent' as const,
              model: 'model',
              instructions: 'Check the task',
            };
      mocks.connectedApps = () =>
        new Set(problem === 'missing connection' ? [] : ['example']);
      const previousTask = {
        steps: [
          {
            type: 'code' as const,
            title: 'File invoices',
            source: 'macro.tasks.create(x)',
          },
          agent,
        ],
        mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
        sdk: '0.2.0+old',
      };
      const proposed = {
        ...previousTask,
        steps: [
          {
            type: 'code' as const,
            title: 'File invoices',
            source: 'macro.tasks.add(x)',
          },
          agent,
        ],
        sdk: '0.3.0+new',
      };
      setSchedules([{ ...paused, task: previousTask }]);
      mocks.codeUpgrades = () => [{ ...upgrade(proposed), previousTask }];
      render(() => <Routine />);
      expect(screen.getByRole('alert')).toBeTruthy();
      const approve = screen.getByRole<HTMLButtonElement>('button', {
        name: 'Approve and resume',
      });
      expect(approve.disabled).toBe(true);
      fireEvent.click(approve);
      expect(mocks.update).not.toHaveBeenCalled();
    }
  );

  it('withdraws the old proposal after the saved task loses its last code step', () => {
    setSchedules([paused]);
    mocks.codeUpgrades = () => [
      upgrade(code('macro.tasks.add(x)', '0.3.0+new')),
    ];
    render(() => <Routine />);
    expect(
      screen.getByRole('button', { name: 'Approve and resume' })
    ).toBeTruthy();

    setSchedules([
      {
        ...paused,
        configuration_revision: paused.configuration_revision + 1,
        task: {
          steps: [{ type: 'agent', model: 'm', instructions: 'Summarize' }],
        },
      },
    ]);

    expect(
      screen.queryByRole('button', { name: 'Approve and resume' })
    ).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });

  it('shows why it paused and saves the proposed update when approved', async () => {
    setSchedules([paused]);
    mocks.update.mockResolvedValue({
      ...paused,
      task: code('macro.tasks.add(x)', '0.3.0+new'),
    });
    mocks.codeUpgrades = () => [
      upgrade(code('macro.tasks.add(x)', '0.3.0+new')),
    ];
    render(() => <Routine />);
    expect(screen.getByText('Paused: its code needs an update')).toBeTruthy();
    expect(screen.getByText('“File invoices” failed a dry run.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review the update' }));
    expect(screen.getByText('macro.tasks.add(x)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and resume' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.update).toHaveBeenCalledWith({
      scheduleId: cron.id,
      body: expect.objectContaining({
        task: expect.objectContaining({
          steps: [
            {
              type: 'code',
              title: 'File invoices',
              source: 'macro.tasks.add(x)',
            },
          ],
        }),
      }),
    });
    expect(mocks.setEnabled).toHaveBeenCalledWith({
      scheduleId: 'routine-id',
      enabled: true,
    });
    expect(mocks.refetchUpgrades).toHaveBeenCalled();
  });

  it('rejects approval when a fresh server read differs from the cached task', async () => {
    const fresh: ScheduledAction = {
      ...paused,
      configuration_revision: paused.configuration_revision + 1,
      task: {
        steps: [{ type: 'agent', model: 'm', instructions: 'Summarize' }],
      },
    };
    setSchedules([paused]);
    mocks.codeUpgrades = () => [
      upgrade(code('macro.tasks.add(x)', '0.3.0+new')),
    ];
    mocks.realRoutineQuery = true;
    mocks.getRoutine.mockImplementation(async (_id, options) =>
      ok(options?.cache === 'no-store' ? fresh : paused)
    );
    const key = scheduledActionKeys.detail({
      scheduleId: 'routine-id',
    }).queryKey;
    queryClient.setQueryData(key, paused);
    const { unmount } = render(() => (
      <QueryClientProvider client={queryClient}>
        <Routine />
      </QueryClientProvider>
    ));
    try {
      fireEvent.click(
        screen.getByRole('button', { name: 'Approve and resume' })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.setEnabled).not.toHaveBeenCalled();
      expect(mocks.getRoutine).toHaveBeenCalledWith('routine-id', {
        cache: 'no-store',
      });
      expect(queryClient.getQueryData(key)).toEqual(fresh);
      expect(
        screen.queryByRole('button', { name: 'Approve and resume' })
      ).toBeNull();
      expect(toast.alert).toHaveBeenCalledWith(
        'The routine changed since the code update was proposed'
      );
    } finally {
      unmount();
      queryClient.removeQueries({ queryKey: key });
    }
  });

  it('holds approval while an autosave is queued or in flight', async () => {
    const saving = Promise.withResolvers<ScheduledAction>();
    setSchedules([paused]);
    mocks.update.mockReturnValue(saving.promise);
    mocks.codeUpgrades = () => [
      upgrade(code('macro.tasks.add(x)', '0.3.0+new')),
    ];
    render(() => <Routine />);
    const approve = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Approve and resume',
    });
    fireEvent.click(
      screen.getByRole('switch', { name: 'Show runs in Home and Agents' })
    );

    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(mocks.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(approve.disabled).toBe(true);
    saving.resolve({ ...paused, run_visibility: 'listed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(approve.disabled).toBe(false);
  });

  it('reports a failed resume after saving and locks settings during approval', async () => {
    const saving = Promise.withResolvers<ScheduledAction>();
    const proposed = code('macro.tasks.add(x)', '0.3.0+new');
    setSchedules([paused]);
    mocks.codeUpgrades = () => [upgrade(proposed)];
    mocks.update.mockReturnValue(saving.promise);
    mocks.setEnabled.mockRejectedValueOnce(
      new Error('Installation unavailable')
    );
    render(() => <Routine />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and resume' }));
    for (const name of ['Show runs in Home and Agents', 'Act as me']) {
      expect(
        screen.getByRole<HTMLButtonElement>('switch', { name }).disabled
      ).toBe(true);
    }
    saving.resolve({ ...paused, task: proposed });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(toast.alert).toHaveBeenCalledWith(
      'Code saved, but the routine could not resume',
      {
        subtext: 'Installation unavailable',
      }
    );
  });

  it('reports a failed review refresh after saving separately from a failed save', async () => {
    const proposed = code('macro.tasks.add(x)', '0.3.0+new');
    setSchedules([paused]);
    mocks.codeUpgrades = () => [upgrade(proposed)];
    mocks.update.mockResolvedValue({ ...paused, task: proposed });
    mocks.refetchUpgrades.mockRejectedValueOnce(
      new Error('Status unavailable')
    );
    render(() => <Routine />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and resume' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.alert).toHaveBeenCalledWith(
      'Code saved, but the review status could not refresh',
      {
        subtext: 'Status unavailable',
      }
    );
  });

  it('traces save, failed activation and refetch under one approval', async () => {
    setSchedules([paused]);
    const proposal = code('macro.tasks.add(x)', '0.3.0+new');
    mocks.update.mockResolvedValue({ ...paused, task: proposal });
    mocks.codeUpgrades = () => [upgrade(proposal)];
    mocks.setEnabled.mockRejectedValueOnce(new Error('Activation failed'));
    let activePhase: string | undefined;
    const phases = new Map<string, Span>();
    const root: Span = {
      span: NOOP_SPAN.span,
      run: NOOP_SPAN.run,
      setAttr: NOOP_SPAN.setAttr,
      event: NOOP_SPAN.event,
      traceparent: NOOP_SPAN.traceparent,
      injectTraceHeaders: NOOP_SPAN.injectTraceHeaders,
      end: vi.fn(),
      error: vi.fn(),
    };
    vi.spyOn(root, 'span').mockImplementation((name) => {
      const phase: Span = {
        ...root,
        run(work) {
          const previous = activePhase;
          activePhase = name;
          try {
            return work();
          } finally {
            activePhase = previous;
          }
        },
        error: vi.fn(),
        end: vi.fn(),
      };
      phases.set(name, phase);
      return phase;
    });
    const admission = { ...root, span: NOOP_SPAN.span };
    const start = vi.spyOn(admission, 'span').mockReturnValue(root);
    const release = vi.fn();
    vi.mocked(beginInteraction).mockReturnValueOnce({
      span: admission,
      hold: () => release,
      end: vi.fn(),
    });
    try {
      mocks.refetchUpgrades.mockImplementationOnce(async () => {
        expect(activePhase).toBe('routine.code_approval.refetch');
      });
      render(() => <Routine />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Approve and resume' })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(beginInteraction).toHaveBeenCalledWith(
        'routine.code_approval.action',
        {
          attributes: { 'routine.id': 'routine-id' },
        }
      );
      expect(start).toHaveBeenCalledWith('routine.code_approval');
      expect(mocks.updateTrace).toHaveBeenCalledWith(
        phases.get('routine.save')
      );
      expect(mocks.activationTrace).toHaveBeenCalledWith(
        phases.get('routine.code_approval.activate')
      );
      expect(
        phases.get('routine.code_approval.activate')?.error
      ).toHaveBeenCalledOnce();
      expect(root.error).toHaveBeenCalledOnce();
      expect(root.end).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledExactlyOnceWith('error');
      expect(mocks.refetchUpgrades).toHaveBeenCalledOnce();
    } finally {
      start.mockRestore();
    }
  });

  it('shows nothing once its code checks against that SDK', () => {
    setSchedules([{ ...paused, task: code('x', '0.3.0+new') }]);
    mocks.codeUpgrades = () => [upgrade()];
    render(() => <Routine />);
    expect(screen.queryByText('Paused: its code needs an update')).toBeNull();
  });

  it('saves the sub-routines’ rewritten code with the rest, and keeps a routine on when only they run it', async () => {
    const withDefinition = (source: string, sdk: string): RoutineTask => ({
      steps: [{ type: 'agent', model: 'm', instructions: 'Plan reminders' }],
      sub_routines: [
        {
          name: 'remind',
          title: 'Remind me',
          steps: [{ type: 'code', title: 'Remind', source }],
        },
      ],
      sdk,
    });
    // Its own steps run no code, so the upgrade left it on.
    const enabled: ScheduledAction = {
      ...cron,
      enabled: true,
      task: withDefinition('macro.tasks.create(x)', '0.2.0+old'),
    };
    setSchedules([enabled]);
    const saving = Promise.withResolvers<ScheduledAction>();
    mocks.update.mockReturnValue(saving.promise);
    mocks.codeUpgrades = () => [
      {
        ...upgrade(withDefinition('macro.tasks.add(x)', '0.3.0+new')),
        previousTask: enabled.task,
      },
    ];
    render(() => <Routine />);
    expect(screen.queryByText('Paused: its code needs an update')).toBeNull();
    expect(
      screen.getByText('Its sub-routines’ code needs an update')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review the update' }));
    expect(screen.getByText('Remind (in Remind me)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const toggle = screen.getByRole<HTMLButtonElement>('switch', {
      name: 'Enabled',
    });
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    mocks.changePrompt('An edit during approval');
    saving.resolve({
      ...enabled,
      task: withDefinition('macro.tasks.add(x)', '0.3.0+new'),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.update).toHaveBeenCalledWith({
      scheduleId: cron.id,
      body: expect.objectContaining({
        task: expect.objectContaining({
          sub_routines: [
            expect.objectContaining({
              name: 'remind',
              steps: [
                expect.objectContaining({ source: 'macro.tasks.add(x)' }),
              ],
            }),
          ],
        }),
      }),
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });
});

describe('sub-routines defined once', () => {
  const remind = {
    name: 'remind',
    title: 'Remind me',
    inputs: [{ type: 'text' as const, name: 'taskId', label: 'Task' }],
    steps: [
      {
        type: 'agent' as const,
        model: 'claude-sonnet-4-6',
        instructions: 'Remind me about the task.',
      },
    ],
  };
  const parent: ScheduledAction = {
    ...events,
    id: 'parent-id',
    name: 'Due reminders',
    task: {
      steps: [
        {
          type: 'code',
          title: 'Find tasks due soon',
          source: 'export async function main() {}',
        },
      ],
      sub_routines: [remind],
    },
  };
  const copy: ScheduledAction = {
    ...events,
    id: 'routine-id',
    name: 'Remind me',
    trigger: { type: 'once', at: '2026-12-01T09:00:00Z' },
    task: { sub_routine: 'remind', inputs: { taskId: 'Ship the deck' } },
    sub_routine: { parent_id: 'parent-id', created_by_run_id: 'run-1' },
  };

  it('starts an interaction before reading sharing status from the menu', () => {
    setSchedules([{ ...parent, id: 'routine-id' }]);
    mocks.sharing = () => true;
    render(() => <Routine />);
    expect(mocks.readSharingStatus).not.toHaveBeenCalled();
    openActions();
    expect(beginInteraction).toHaveBeenCalledWith(
      'routine.template.status.action',
      {
        attributes: { 'routine.id': 'routine-id' },
      }
    );
    expect(mocks.readSharingStatus).toHaveBeenCalledExactlyOnceWith(
      'routine-id',
      NOOP_SPAN
    );
  });

  it('reads sharing status when a routine becomes ineligible in an open menu', () => {
    mocks.sharing = () => true;
    render(() => <Routine />);
    openActions();
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeTruthy();
    expect(mocks.readSharingStatus).not.toHaveBeenCalled();

    setSchedules([{ ...parent, id: 'routine-id' }]);
    expect(screen.queryByRole('menuitem', { name: 'Share' })).toBeNull();
    expect(mocks.readSharingStatus).toHaveBeenCalledExactlyOnceWith(
      'routine-id',
      NOOP_SPAN
    );
  });

  it('revokes a published snapshot after the routine gains definitions', () => {
    setSchedules([{ ...parent, id: 'routine-id' }]);
    mocks.sharing = () => true;
    mocks.shared = () => true;
    render(() => <Routine />);
    openActions();

    expect(screen.queryByRole('menuitem', { name: 'Share' })).toBeNull();
    const stopSharing = screen.getByRole('menuitem', { name: 'Stop sharing' });
    expect(
      stopSharing.querySelector('[data-macro-icon="link-break"]')
    ).toBeTruthy();
    fireEvent.keyDown(stopSharing, {
      key: 'Enter',
    });
    expect(mocks.stopSharing).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      parentSpan: NOOP_SPAN,
    });
    expect(beginInteraction).toHaveBeenCalledWith(
      'routine.stop_sharing.action',
      {
        attributes: { 'routine.id': 'routine-id' },
      }
    );
  });

  it('can revoke a cached template when its background refresh fails', () => {
    setSchedules([{ ...parent, id: 'routine-id' }]);
    mocks.sharing = () => true;
    mocks.shared = () => true;
    mocks.templateError = () => true;
    render(() => <Routine />);
    openActions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Stop sharing' }), {
      key: 'Enter',
    });
    expect(mocks.stopSharing).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      parentSpan: NOOP_SPAN,
    });
  });

  it('retries sharing status when the initial template read fails', () => {
    setSchedules([{ ...parent, id: 'routine-id' }]);
    mocks.sharing = () => true;
    mocks.templateError = () => true;
    render(() => <Routine />);
    openActions();
    const retry = screen.getByRole('menuitem', {
      name: 'Retry sharing status',
    });
    expect(
      retry.querySelector('[data-macro-icon="arrow-clockwise"]')
    ).toBeTruthy();
    fireEvent.keyDown(retry, { key: 'Enter' });
    expect(mocks.refetchTemplate).toHaveBeenCalledOnce();
  });

  it('keeps metadata writable while rollout blocks task edits and Duplicate', async () => {
    mocks.subRoutineWrites = () => false;
    setSchedules([{ ...parent, id: 'routine-id' }]);
    render(() => <Routine />);
    const definition = screen.getByRole('group', { name: 'Remind me' });
    expect(definition.closest('fieldset')?.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Show runs in Home and Agents' })
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        task: parent.task,
        run_visibility: 'listed',
      }),
    });
    openActions();
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull();
  });

  it('holds the parent-definition flow phase until the parent list arrives', () => {
    setSchedules([copy]);
    setListStatus('pending');
    render(() => <Routine />);
    const phase = vi
      .mocked(usePending)
      .mock.calls.find(([name]) => name === 'routine.parent_definition');
    expect(phase?.[1]()).toBe(true);
    expect(phase?.[2]?.['routine.parent_id']).toBe('parent-id');
    setSchedules([copy, parent]);
    setListStatus('success');
    expect(phase?.[1]()).toBe(false);
  });

  it('shows the named definition when an unrelated definition is unsupported', () => {
    const task: RoutineTask = JSON.parse(
      JSON.stringify({
        ...parent.task,
        sub_routines: [
          remind,
          { name: 'later', title: 'Later', steps: [{ type: 'future' }] },
        ],
      })
    );
    setSchedules([copy, { ...parent, task }]);
    render(() => <Routine />);
    expect(screen.getByRole('group', { name: 'Remind me' })).toBeTruthy();
  });

  it('lets a copy retry a cold parent list failure', () => {
    setSchedules([copy]);
    setListStatus('error');
    mocks.refetchList.mockImplementationOnce(async () => {
      setSchedules([copy, parent]);
      setListStatus('success');
    });
    render(() => <Routine />);
    const retry = screen.getByRole('button', { name: 'Retry definition' });
    expect(retry.classList.contains('touch:min-h-[44px]')).toBe(true);
    fireEvent.click(retry);
    expect(mocks.refetchList).toHaveBeenCalledOnce();
    expect(screen.getByRole('group', { name: 'Remind me' })).toBeTruthy();
  });

  it('shows each sub-routine with what it is given, and saves an edit to it with the routine', async () => {
    setSchedules([parent]);
    render(() => <Routine />);
    const section = screen.getByRole('region', { name: 'Sub-routines' });
    const definition = within(section).getByRole('group', {
      name: 'Remind me',
    });
    expect(within(definition).getByText('Task')).toBeTruthy();
    fireEvent.input(
      within(definition).getByRole('textbox', { name: 'Instructions' }),
      { target: { value: 'Remind me, and say when it is due.' } }
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        task: {
          steps: (parent.task as { steps: unknown }).steps,
          sub_routines: [
            {
              ...remind,
              mcp_servers: [],
              steps: [
                {
                  ...remind.steps[0],
                  instructions: 'Remind me, and say when it is due.',
                },
              ],
            },
          ],
        },
      }),
    });
  });

  it('sends an explicit empty app selection when the last definition app is removed', async () => {
    const appName = 'A'.repeat(160);
    setSchedules([
      {
        ...parent,
        id: 'routine-id',
        task: {
          steps: [{ type: 'agent', model: 'model', instructions: 'Plan' }],
          sub_routines: [
            {
              ...remind,
              mcp_servers: [{ app_slug: 'example', server_name: appName }],
            },
          ],
        },
      },
    ]);
    render(() => <Routine />);
    const label = screen.getByText(appName);
    expect(label.parentElement?.classList.contains('min-w-0')).toBe(true);
    expect(label.classList.contains('break-words')).toBe(true);
    const remove = screen.getByRole('button', { name: `Remove ${appName}` });
    expect(remove.classList.contains('touch:min-h-[44px]')).toBe(true);
    expect(remove.classList.contains('touch:min-w-[44px]')).toBe(true);
    fireEvent.click(remove);
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        task: expect.objectContaining({
          sub_routines: [{ ...remind, mcp_servers: [] }],
        }),
      }),
    });
  });

  it('holds an edit when only a definition needs a disconnected app', async () => {
    setSchedules([
      {
        ...parent,
        id: 'routine-id',
        task: {
          steps: [{ type: 'agent', model: 'model', instructions: 'Plan' }],
          sub_routines: [
            {
              ...remind,
              mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
            },
          ],
        },
      },
    ]);
    render(() => <Routine />);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Show runs in Home and Agents' })
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      'Connect every app'
    );
  });

  it.each(['routine', 'definition'] as const)(
    'holds a save when the %s Ask AI target cannot run with its connected apps',
    async (scope) => {
      const external = {
        type: 'agent' as const,
        agent: { bot_id: '12345678-1234-1234-1234-123456789abc' },
        instructions: 'Remind me about the task.',
      };
      const mcp_servers = [{ app_slug: 'example', server_name: 'Example' }];
      const isDefinition = scope === 'definition';
      setSchedules([
        {
          ...parent,
          id: 'routine-id',
          task: isDefinition
            ? {
                steps: [remind.steps[0]],
                sub_routines: [{ ...remind, steps: [external], mcp_servers }],
              }
            : { steps: [external], mcp_servers },
        },
      ]);
      mocks.connectedApps = () => new Set(['example']);
      render(() => <Routine />);
      const editor = isDefinition
        ? within(screen.getByRole('group', { name: 'Remind me' }))
        : screen;
      fireEvent.input(editor.getByRole('textbox', { name: 'Instructions' }), {
        target: { value: 'Remind me tomorrow.' },
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toContain(
        'choose a model or managed agent'
      );
      if (isDefinition)
        expect(screen.getByRole('alert').textContent).toContain('Remind me');
      fireEvent.click(editor.getByLabelText('Execution target'));
      await vi.advanceTimersByTimeAsync(300);
      expect(mocks.update).toHaveBeenCalledTimes(1);
    }
  );

  it('offers Keep only after a retained sibling’s app connection is known', () => {
    setSchedules([
      copy,
      {
        ...parent,
        task: {
          ...parent.task,
          steps: [],
          sub_routines: [
            remind,
            {
              ...remind,
              name: 'notify',
              mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
            },
          ],
        },
      },
    ]);
    const [connections, setConnections] = createSignal<ReadonlySet<string>>();
    mocks.connectedApps = connections;
    render(() => <Routine />);
    openActions();
    expect(
      screen.queryByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeNull();
    setConnections(new Set<string>());
    expect(
      screen.queryByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeNull();
    setConnections(new Set(['example']));
    expect(
      screen.getByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeTruthy();
  });

  it.each(['pending', 'failed'])(
    'saves an app-backed edit while the agent lookup is %s',
    async (status) => {
      mocks.agentsPending = () => status === 'pending';
      mocks.agentsFailed = () => status === 'failed';
      mocks.agentHarness = () => 'in-memory';
      mocks.connectedApps = () => new Set(['example']);
      setSchedules([
        {
          ...parent,
          id: 'routine-id',
          task: {
            steps: [
              {
                type: 'agent',
                agent: { bot_id: '12345678-1234-1234-1234-123456789abc' },
                instructions: 'Remind me about the task.',
              },
            ],
            mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
          },
        },
      ]);
      render(() => <Routine />);
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.input(screen.getByRole('textbox', { name: 'Instructions' }), {
        target: { value: 'Remind me tomorrow.' },
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(mocks.update).toHaveBeenCalledOnce();
    }
  );

  it('shows a copy its parent’s steps and its values, editing only its own settings', async () => {
    // The copy's page reads its parent from the routines list.
    setSchedules([copy, parent]);
    render(() => <Routine />);
    expect(
      screen.getByText(
        'Runs “Remind me” from Due reminders. Each run uses the current definition.'
      )
    ).toBeTruthy();
    const values = screen.getByRole('definition');
    expect(values.textContent).toBe('Ship the deck');
    const steps = screen.getByRole('group', { name: 'Remind me' });
    expect(steps.closest('[inert]')).toBeNull();
    expect(
      (
        within(steps).getByRole('textbox', {
          name: 'Instructions',
        }) as HTMLTextAreaElement
      ).value
    ).toBe('Remind me about the task.');
    expect(screen.queryByRole('button', { name: /Add step/ })).toBeNull();
    // Its own settings save with its task as it is.
    fireEvent.click(
      screen.getByRole('switch', { name: 'Show runs in Home and Agents' })
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      body: expect.objectContaining({
        task: copy.task,
        run_visibility: 'listed',
      }),
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit in Due reminders' })
    );
    expect(JSON.stringify(mocks.openWithSplit.mock.calls.at(-1))).toContain(
      'parent-id'
    );
  });

  it('says when a copy’s parent no longer defines what it runs', () => {
    setSchedules([
      copy,
      { ...parent, task: { steps: (parent.task as { steps: never }).steps } },
    ]);
    render(() => <Routine />);
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run options' })).toBeTruthy();
    expect(
      screen.getByText(
        'Its routine no longer defines this, so it fails when it runs.'
      )
    ).toBeTruthy();
    openActions();
    expect(
      screen.queryByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeNull();
    expect(mocks.detach).not.toHaveBeenCalled();
  });

  it('lets a copy expand the full prompt and source without editing the definition', () => {
    const instructions =
      'Remind me about the task.\nInclude the due date and next action.';
    const source = 'export const task = inputs.taskId;';
    setSchedules([
      copy,
      {
        ...parent,
        task: {
          steps: [{ type: 'agent', model: 'model', instructions: 'Plan' }],
          sub_routines: [
            {
              ...remind,
              steps: [
                { type: 'code', title: 'Read the task', source },
                { type: 'agent', model: 'model', instructions },
              ],
            },
          ],
        },
      },
    ]);
    render(() => <Routine />);
    const ask = screen.getByRole('group', { name: 'Ask AI' });
    const disclosure = within(ask).getByRole('button', { name: /Ask AI/ });
    expect(disclosure.closest('[inert]')).toBeNull();
    fireEvent.click(disclosure);
    const editor = within(ask).getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Instructions',
    });
    expect(editor.value).toBe(instructions);
    expect(editor.disabled).toBe(true);

    const code = screen.getByRole('group', { name: 'Read the task' });
    fireEvent.click(within(code).getByRole('button', { name: 'Show code' }));
    expect(within(code).getByLabelText('Code').textContent).toBe(source);
    expect(screen.queryByRole('button', { name: 'Step actions' })).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('keeps a copy whose definition still exists using detach', () => {
    setSchedules([copy, parent]);
    render(() => <Routine />);
    openActions();
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: 'Keep as my routine' }),
      { key: 'Enter' }
    );
    expect(mocks.detach).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      parentSpan: NOOP_SPAN,
    });
    expect(beginInteraction).toHaveBeenCalledWith('routine.keep.action', {
      attributes: { 'routine.id': 'routine-id' },
    });
  });

  it('withholds Keep during a claimed copy run', () => {
    setSchedules([{ ...copy, claimed: new Date().toISOString() }, parent]);
    render(() => <Routine />);
    openActions();
    expect(
      screen.queryByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeNull();
    setSchedules([copy, parent]);
    expect(
      screen.getByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeTruthy();
  });

  it('withholds Keep for an event-triggered copy until event management is enabled', () => {
    const [eventWrites, setEventWrites] = createSignal(false);
    mocks.eventWrites = eventWrites;
    setSchedules([{ ...copy, trigger: events.trigger }, parent]);
    render(() => <Routine />);
    openActions();
    expect(
      screen.queryByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeNull();
    setEventWrites(true);
    expect(
      screen.getByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeTruthy();
  });

  it('still detaches an ordinary event sub-routine with event management off', () => {
    mocks.eventWrites = () => false;
    setSchedules([{ ...events, sub_routine: copy.sub_routine }, parent]);
    render(() => <Routine />);
    openActions();
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: 'Keep as my routine' }),
      { key: 'Enter' }
    );
    expect(mocks.detach).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine-id',
      parentSpan: NOOP_SPAN,
    });
  });

  it('withholds Keep when the current definition requires different inputs', () => {
    setSchedules([
      copy,
      {
        ...parent,
        task: {
          steps: [{ type: 'agent', model: 'model', instructions: 'Plan' }],
          sub_routines: [
            {
              ...remind,
              inputs: [{ type: 'text', name: 'itemId', label: 'Item' }],
            },
          ],
        },
      },
    ]);
    render(() => <Routine />);
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    setSchedules([copy, parent]);
    expect(runButton().disabled).toBe(false);
    setSchedules([
      { ...copy, task: { sub_routine: 'remind', inputs: { taskId: false } } },
      parent,
    ]);
    openActions();
    expect(
      screen.queryByRole('menuitem', { name: 'Keep as my routine' })
    ).toBeNull();
    expect(mocks.detach).not.toHaveBeenCalled();
  });

  it('lets long copy labels and step titles wrap without taking over a narrow pane', () => {
    const label = 'A'.repeat(60);
    const title = 'B'.repeat(60);
    const knobValue = 'C'.repeat(120);
    setSchedules([
      copy,
      {
        ...parent,
        task: {
          steps: [{ type: 'agent', model: 'model', instructions: 'Plan' }],
          sub_routines: [
            {
              ...remind,
              inputs: [{ type: 'text', name: 'taskId', label }],
              steps: [
                {
                  type: 'code',
                  title,
                  source: 'export function main() {}',
                  knobs: [
                    {
                      type: 'text',
                      name: 'note',
                      label: 'Note',
                      value: knobValue,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
    render(() => <Routine />);
    const given = within(screen.getByLabelText('Given'));
    const term = given.getByRole('term');
    expect(term.textContent).toBe(label);
    expect(term.classList.contains('wrap-anywhere')).toBe(true);
    expect(given.getByRole('definition').textContent).toBe('Ship the deck');
    const knob = screen.getByText(knobValue);
    expect(knob.classList.contains('wrap-anywhere')).toBe(true);
    expect(
      knob
        .closest('dl')
        ?.classList.contains('grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Show code' })
        .classList.contains('touch:min-h-[44px]')
    ).toBe(true);
    expect(screen.getByText(title).classList.contains('min-w-0')).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Edit in Due reminders' })
        .classList.contains('touch:min-h-[44px]')
    ).toBe(true);
  });

  it('wraps a copy’s interpolated sentence and fallback summary in a narrow pane', () => {
    const note = 'A'.repeat(120);
    const summary = 'B'.repeat(120);
    setSchedules([
      copy,
      {
        ...parent,
        task: {
          steps: [],
          sub_routines: [
            {
              ...remind,
              steps: [
                {
                  type: 'code',
                  title: 'Read note',
                  source: 'export function main() {}',
                  sentence: 'Read {note}.',
                  knobs: [
                    { type: 'text', name: 'note', label: 'Note', value: note },
                  ],
                },
                {
                  type: 'code',
                  title: 'Write note',
                  source: 'export function main() {}',
                  summary,
                },
              ],
            },
          ],
        },
      },
    ]);
    render(() => <Routine />);
    for (const content of [`Read ${note}.`, summary]) {
      expect(
        screen.getByText(content).classList.contains('wrap-anywhere')
      ).toBe(true);
    }
  });

  it('offers manual steps only when a detached program has input values', () => {
    const detached: ScheduledAction = {
      ...copy,
      sub_routine: undefined,
      task: {
        inputs: [
          { type: 'text', name: 'taskId', label: 'Task', value: 'example' },
        ],
        steps: [
          {
            type: 'code',
            title: 'Remind',
            source: 'export const task = inputs.taskId;',
          },
        ],
      },
    };
    setSchedules([detached]);
    render(() => <Routine />);
    expect(screen.queryByRole('textbox', { name: 'Add a step' })).toBeNull();
    const menu = screen.getByRole('button', { name: 'Step actions' });
    menu.focus();
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Show code' })).toBeTruthy();
  });
});
