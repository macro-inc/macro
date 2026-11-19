import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import {
  beginInteraction as flowBeginInteraction,
  usePending as flowUsePending,
} from '@app/observability/flow';
import { toast as testToast } from '@core/component/Toast/Toast';
import { NOOP_SPAN, type TraceContext } from '@macro-inc/observability';
import type {
  CodeUpgrade,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { okAsync, type ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  type Setter,
  untrack,
} from 'solid-js';
import { afterEach, beforeEach, vi } from 'vitest';
import type { RoutineTarget } from '../core/routine-target';
import { Routine as RoutineUnderTest } from '../routine-detail';
import type { HistoryRecord } from '../views/routine-history';

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
  /** Its last read of them failed, keeping the data it had. */
  upgradesFailed: (): boolean => false,
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
  fetchChildren:
    vi.fn<(id: string) => ResultAsync<ScheduledAction[], unknown>>(),
  agentsPending: (): boolean => false,
  agentsFailed: (): boolean => false,
  agentsRetained: (): boolean => false,
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
vi.mock('../queries/routines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../queries/routines')>();
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
vi.mock('../routine-triggers', () => ({
  RoutineTriggers: () => <div>Triggers</div>,
}));
vi.mock('../routine-template', () => ({
  RoutineTemplatePage: (props: { scheduleId: string }) => (
    <div>Template for {props.scheduleId}</div>
  ),
  openShareRoutineDialog: vi.fn(),
}));
vi.mock('../queries/templates', () => ({
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
vi.mock('../routine-ai-composer', () => ({
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
vi.mock('../routine-step-pickers', () => ({
  routineToolSlots: {
    LabelPicker: () => null,
    TagPicker: () => null,
    ChannelPicker: () => null,
    AssigneePicker: () => null,
    FolderPicker: () => null,
  },
}));
vi.mock('../routine-prompt-editor', () => ({
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
vi.mock('../routine-apps', () => ({
  RoutineApps: () => null,
}));
vi.mock('../queries/connected-apps', () => ({
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
      if (mocks.agentsFailed() && !mocks.agentsRetained()) return undefined;
      return [
        {
          bot: { id: '12345678-1234-1234-1234-123456789abc' },
          harness: mocks.agentHarness(),
        },
      ];
    },
  }),
}));
vi.mock('../routine-execution-picker', () => ({
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
vi.mock('../queries/schedules', () => ({
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
    get isSuccess() {
      return !mocks.upgradesFailed();
    },
    get isError() {
      return mocks.upgradesFailed();
    },
    isPending: false,
    get data() {
      return mocks.codeUpgrades();
    },
    refetch: mocks.refetchUpgrades,
  }),
  useChildrenQuery: () => ({ isSuccess: true, data: [] }),
  fetchChildren: (id: string) => mocks.fetchChildren(id),
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
  mocks.fetchChildren.mockReset().mockReturnValue(okAsync([]));
  vi.useFakeTimers();
  [mocks.status, setStatus] = createSignal('success');
  [mocks.listStatus, setListStatus] = createSignal('');
  [mocks.readSchedules, setSchedules] = createSignal([cron]);
  [mocks.activationPending, setActivationPending] = createSignal(false);
  mocks.metadataStatus = () => 'success';
  mocks.chatMetadata = () => ({ chat: { name: 'Run transcript' } });
  mocks.agentMetadata = () => ({ name: 'Agent transcript' });
  mocks.codeUpgrades = () => [];
  mocks.upgradesFailed = () => false;
  mocks.sharing = () => false;
  mocks.subRoutineWrites = () => true;
  mocks.eventWrites = () => true;
  mocks.shared = () => false;
  mocks.templateError = () => false;
  mocks.connectedApps = () => new Set();
  mocks.realRoutineQuery = false;
  mocks.agentsPending = () => false;
  mocks.agentsFailed = () => false;
  mocks.agentsRetained = () => false;
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

const agentTarget = {
  kind: 'agent',
  agentId: '0195dbd2-6539-7000-8000-000000000001',
  modelOverride: 'runtime-model',
} satisfies RoutineTarget;

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

export {
  activationItem,
  agentTarget,
  cron,
  deferredSave,
  events,
  mocks,
  openActions,
  openRunOptions,
  parent,
  remind,
  runButton,
  selectedTarget,
  setActivationPending,
  setListStatus,
  setSchedules,
  setStatus,
};

export const beginInteraction = flowBeginInteraction;
export const usePending = flowUsePending;
export const toast = testToast;
export const Routine = RoutineUnderTest;
/** The mocked bulk-edit modal Delete opens. */
export const openDeleteModal = openBulkEditModal;
