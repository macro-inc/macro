import type {
  CreateScheduledAction,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgentRoster } from '../agents-view/core/roster';
import { getDefaultTimezone } from './core/routine-draft';
import { loadRoutineComposerDraft } from './draft-storage';
import { onceFromCron } from './queries/routine-trigger-mapping';
import { RoutineCreator } from './routine-creator';
import { RoutineNew } from './routine-new';

const host = vi.hoisted(() => ({
  create: vi.fn<(body: CreateScheduledAction) => Promise<ScheduledAction>>(),
  openWithSplit: vi.fn(),
  created: vi.fn(),
  flags: new Set<string>(),
  cancelled: vi.fn(),
  started: vi.fn(),
  success: vi.fn(),
  alert: vi.fn(),
  editorMount: vi.fn(),
  githubLinked: true as boolean | undefined,
  connectGithub: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: host.flags.has(flag.key),
  }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: host.openWithSplit }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
  useSplitPanelOrThrow: () => ({
    handle: { close: vi.fn(), setDisplayName: vi.fn() },
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
vi.mock('@queries/agent-repositories/repositories', () => ({
  useAgentRepositoriesQuery: () => ({
    isSuccess: true,
    isLoading: false,
    isError: false,
    data: {
      repositories: [
        { url: 'https://github.com/macro-inc/macro' },
        { url: 'https://github.com/macro-inc/docs' },
      ],
    },
  }),
}));
vi.mock('./queries/github-link', () => ({
  createGithubConnection: () => () => ({
    linked: host.githubLinked,
    connecting: false,
    connect: host.connectGithub,
  }),
}));
vi.mock('./routine-event-scope', () => ({
  RoutineEventScope: () => <span>Any document</span>,
  RoutineEventScopeLabel: () => <span>Any document</span>,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: host.success, alert: host.alert },
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('../agents-view/primitives/open-page', () => ({
  openAgentsPage: vi.fn(),
}));
vi.mock('@core/auth/license', () => ({ useHasPaidAccess: () => () => true }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));
vi.mock('./queries/schedules', async () => {
  const { useMutation } = await import('@tanstack/solid-query');
  return {
    useCreateScheduleMutation: (callbacks: {
      onSuccess: (schedule: ScheduledAction) => Promise<void>;
      onError: (error: Error) => void;
    }) => useMutation(() => ({ mutationFn: host.create, ...callbacks })),
  };
});

// Keep the real trigger menu, picker, model discovery adapter, storage, and mutation
// lifecycle. The editor double exposes initialValue and detects any remount.
vi.mock('./routine-ai-composer', () => ({ RoutineAiComposer: () => null }));
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
    onChange: (value: string) => void;
  }): JSX.Element => {
    host.editorMount();
    const initialValue = props.initialValue;
    return (
      <textarea
        aria-label="Instructions"
        value={initialValue}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  },
}));

const agentId = '12345678-1234-1234-1234-123456789abc';
const [catalogState, setCatalogState] = createSignal<
  'pending' | 'success' | 'error'
>('success');
vi.mock('../agents-view/queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({
    roster: () =>
      buildAgentRoster({
        agents: [
          {
            bot: { id: agentId, name: 'Researcher', handle: 'researcher' },
            harness: 'in-memory',
            default_model: 'claude-sonnet-4-6',
          },
        ],
        runtimes: [],
        cursorConnected: false,
        cursorNeedsConnection: true,
      }),
    loading: () => false,
    error: () => false,
    availabilityLoading: () => false,
  }),
}));
vi.mock('@queries/agents/models', () => ({
  useAgentModelsQuery: () => ({
    get isSuccess() {
      return catalogState() === 'success';
    },
    get isPending() {
      return catalogState() === 'pending';
    },
    get isError() {
      return catalogState() === 'error';
    },
    get data() {
      if (catalogState() !== 'success') throw new Error('Unsafe catalog read');
      return {
        status: 'available',
        models: [
          { id: 'claude-sonnet-4-6', name: 'Sonnet' },
          { id: 'vendor/custom-model', name: 'Custom model' },
        ],
      };
    },
  }),
}));

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let styles: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks();
  host.githubLinked = true;
  host.flags = new Set([
    'enable-routine-conditions',
    'enable-routine-starter-templates',
  ]);
  localStorage.clear();
  setCatalogState('success');
  styles = document.createElement('style');
  styles.textContent = '* { animation-name: none; transition-duration: 0s; }';
  document.head.append(styles);
  vi.stubGlobal('scrollTo', vi.fn());
  // The page measures its pane; every test unstubs globals afterwards.
  vi.stubGlobal('ResizeObserver', NoResize);
});
afterEach(() => {
  cleanup();
  styles.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(() => (
    <QueryClientProvider client={client}>
      <RoutineNew onCreated={host.created} onCancel={host.cancelled} />
    </QueryClientProvider>
  ));
  // A blank page starts without steps; an unsent draft resumes as it was.
  if (!screen.queryByRole('textbox', { name: 'Instructions' })) {
    fireEvent.click(await screen.findByRole('button', { name: 'Add step' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Ask AI/ }));
  }
  await screen.findByRole('textbox', { name: 'Routine name' });
  await screen.findByRole('textbox', { name: 'Instructions' });
}

function inputPrompt(value = 'Summarize updates'): HTMLTextAreaElement {
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Instructions',
  });
  fireEvent.input(editor, { target: { value } });
  return editor;
}

function openPicker(): void {
  const trigger = screen.getByRole('button', { name: 'Agent' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

async function selectTarget(
  target: 'model' | 'agent' | 'override'
): Promise<void> {
  openPicker();
  if (target === 'agent') {
    fireEvent.click(screen.getByRole('menuitem', { name: /^Researcher/ }));
  } else {
    let menu: HTMLElement | undefined;
    if (target === 'override') {
      const row = screen.getByRole('menuitem', { name: /^Researcher/ });
      row.focus();
      fireEvent.keyDown(row, { key: 'ArrowRight' });
      // Do not select the same model from the root Macro catalog.
      menu = await screen.findByRole('menu', { name: /^Researcher/ });
      await within(menu).findByRole('textbox', { name: 'Search models' });
    }
    const item = (menu ? within(menu) : screen).getByRole('menuitem', {
      name: 'Custom model',
    });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
  }
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Agent' })
        .getAttribute('aria-expanded')
    ).toBe('false')
  );
}

function create(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
}
/** Kobalte menus open from the keyboard in jsdom. */
function press(element: HTMLElement, key: string) {
  element.focus();
  fireEvent.keyDown(element, { key });
}
/** Add trigger, then a trigger from its type's submenu. */
function chooseTrigger(type: string, name: string) {
  press(screen.getAllByRole('button', { name: 'Add trigger' })[0]!, 'Enter');
  press(
    screen.getByRole('menuitem', { name: type, hidden: true }),
    'ArrowRight'
  );
  press(
    screen.getByRole('menuitem', {
      name: new RegExp(`^${name}`),
      hidden: true,
    }),
    'Enter'
  );
}
async function addScheduled(name = 'Daily') {
  const add = screen.getByRole('button', { name: 'Add trigger' });
  chooseTrigger('Schedule', 'On a schedule');
  fireEvent.click(await screen.findByRole('radio', { name }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Add trigger' })).getByRole(
      'button',
      { name: 'Add trigger' }
    )
  );
  await waitFor(() => expect(add.getAttribute('aria-expanded')).toBe('false'));
}
async function addDocumentEvent() {
  const add = screen.getByRole('button', { name: 'Add trigger' });
  chooseTrigger('Documents', 'Document created');
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Add trigger' })).getByRole(
      'button',
      { name: 'Add trigger' }
    )
  );
  await waitFor(() => expect(add.getAttribute('aria-expanded')).toBe('false'));
}

function created(body: CreateScheduledAction): ScheduledAction {
  if (!('trigger' in body)) throw new Error('Expected a tagged trigger');
  return {
    ...body,
    run_visibility:
      'run_visibility' in body && body.run_visibility
        ? body.run_visibility
        : 'unlisted',
    id: 'new-routine',
    owner: 'macro|owner@example.com',
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    configuration_revision: 1,
  };
}

describe('routine composer execution selection', () => {
  it.each(['model', 'agent', 'override'] as const)(
    'submits a %s target with unchanged cron and timezone behavior',
    async (target) => {
      host.create.mockImplementation(async (body) => created(body));
      await mount();
      inputPrompt('  Summarize updates  ');
      await addScheduled();
      await selectTarget(target);
      create();
      await waitFor(() => expect(host.create).toHaveBeenCalledOnce());
      const body = host.create.mock.calls[0][0];
      const expectedTask: Record<string, unknown> = {
        prompt: '',
        user_prompt: 'Summarize updates',
        mcp_servers: [],
      };
      if (target === 'model') expectedTask.model = 'vendor/custom-model';
      else expectedTask.agent = { bot_id: agentId };
      if (target === 'override') expectedTask.model = 'vendor/custom-model';
      expect(body.task).toEqual(expectedTask);
      expect(body).toMatchObject({
        trigger: {
          type: 'cron',
          schedule: '0 0 9 * * *',
          timezone: getDefaultTimezone(),
        },
      });
      await waitFor(() =>
        expect(host.created).toHaveBeenCalledWith('new-routine')
      );
      expect(body.enabled).toBe(true);
      expect(body).toMatchObject({ run_visibility: 'unlisted' });
    }
  );

  it('creates a routine whose runs show in Home and Agents when asked', async () => {
    host.create.mockImplementation(async (body) => created(body));
    await mount();
    inputPrompt('Summarize updates');
    await addScheduled();
    const visibility = screen.getByRole<HTMLInputElement>('switch', {
      name: 'Show runs in Home and Agents',
    });
    expect(visibility.checked).toBe(false);
    fireEvent.click(visibility);
    expect(visibility.checked).toBe(true);
    create();
    await waitFor(() => expect(host.create).toHaveBeenCalledOnce());
    expect(host.create.mock.calls[0][0]).toMatchObject({
      run_visibility: 'listed',
    });
  });

  it('restores the latest selection and prompt even when closed before the save timer', async () => {
    await mount();
    inputPrompt();
    await selectTarget('override');
    vi.useFakeTimers();
    inputPrompt('Last keystroke');
    cleanup();
    expect(loadRoutineComposerDraft()).toMatchObject({
      prompt: 'Last keystroke',
      target: { kind: 'agent', agentId, modelOverride: 'vendor/custom-model' },
    });
    await mount();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Instructions' })
        .value
    ).toBe('Last keystroke');
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Researcher'
    );
    vi.advanceTimersByTime(500);
    expect(loadRoutineComposerDraft()?.target).toEqual({
      kind: 'agent',
      agentId,
      modelOverride: 'vendor/custom-model',
    });
  });

  it('retains the draft after an API selection error and allows retry', async () => {
    host.create.mockRejectedValueOnce(
      new Error('The selected agent is unavailable.')
    );
    host.create.mockImplementation(async (body) => created(body));
    await mount();
    const editor = inputPrompt();
    await addScheduled();
    await selectTarget('agent');
    create();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The selected agent is unavailable.'
    );
    expect(host.created).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: 'Create routine' });
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    cleanup();
    expect(loadRoutineComposerDraft()?.target).toEqual({
      kind: 'agent',
      agentId,
    });
    await mount();
    create();
    await waitFor(() => expect(host.create).toHaveBeenCalledTimes(2));
    expect(host.create.mock.calls[1][0]).toEqual(host.create.mock.calls[0][0]);
    await waitFor(() =>
      expect(host.created).toHaveBeenCalledWith('new-routine')
    );
  });

  it('locks selection and submission while creating and cancels queued saves on success', async () => {
    let resolveCreate!: (value: ScheduledAction) => void;
    host.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );
    await mount();
    await selectTarget('agent');
    await addScheduled();
    vi.useFakeTimers();
    inputPrompt();
    create();
    await vi.advanceTimersByTimeAsync(0);
    const picker = screen.getByRole('button', { name: 'Agent' });
    expect(picker.closest('fieldset')?.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Creating…' })
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Creating…' }));
    expect(host.create).toHaveBeenCalledOnce();
    resolveCreate(created(host.create.mock.calls[0][0]));
    await vi.advanceTimersByTimeAsync(0);
    expect(host.created).toHaveBeenCalledWith('new-routine');
    expect(loadRoutineComposerDraft()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadRoutineComposerDraft()).toBeNull();
    cleanup();
    // Nothing was kept, so the next routine starts fresh.
    vi.useRealTimers();
    await mount();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Instructions' })
        .value
    ).toBe('');
  });

  it('does not remount the prompt editor when targets or catalog status change', async () => {
    await mount();
    const editor = inputPrompt();
    await selectTarget('agent');
    setCatalogState('pending');
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    setCatalogState('error');
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    setCatalogState('success');
    await selectTarget('override');
    await selectTarget('model');
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    expect(editor.value).toBe('Summarize updates');
    expect(host.editorMount).toHaveBeenCalledOnce();
  });

  it('requires instructions and at least one trigger, with no history in creation', async () => {
    await mount();
    create();
    expect(screen.getByText('Instructions are required.')).toBeTruthy();
    inputPrompt();
    create();
    expect(
      screen.getByText('Add a trigger to tell this routine when to run.')
    ).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Run History' })).toBeNull();
    expect(host.create).not.toHaveBeenCalled();
  });
  it('creates recurring schedules and Macro events together', async () => {
    host.create.mockImplementation(async (body) => created(body));
    await mount();
    inputPrompt();
    await addScheduled('Daily');
    await addScheduled('Weekly');
    await addDocumentEvent();
    create();
    await waitFor(() => expect(host.create).toHaveBeenCalledOnce());
    expect(host.create.mock.calls[0][0]).toMatchObject({
      enabled: true,
      trigger: {
        type: 'multiple',
        triggers: [
          {
            type: 'cron',
            schedule: '0 0 9 * * *',
            timezone: getDefaultTimezone(),
          },
          {
            type: 'cron',
            schedule: '0 0 9 * * 2',
            timezone: getDefaultTimezone(),
          },
          { type: 'events', filters: [{ events: ['document.created'] }] },
        ],
      },
    });
  });
  it('offers the focused Macro event catalog and saves new task and email triggers', async () => {
    host.create.mockImplementation(async (body) => created(body));
    await mount();
    inputPrompt();
    press(screen.getByRole('button', { name: 'Add trigger' }), 'Enter');
    for (const name of [
      'Schedule',
      'Email',
      'Tasks',
      'Channels',
      'Documents',
    ]) {
      expect(screen.getByRole('menuitem', { name, hidden: true })).toBeTruthy();
    }
    // Searching reaches every submenu's events.
    const search = screen.getByRole('textbox', { name: 'Search triggers' });
    for (const name of [
      'On a schedule',
      'Once',
      'Channel created',
      'Message sent in channel',
      '@ mentioned in channel',
      'Document created',
      'Document deleted',
      'Task created',
      'Status changed',
      'Priority changed',
      'Any property changed',
      'New email received',
    ]) {
      fireEvent.input(search, { target: { value: name } });
      expect(
        screen.getByRole('menuitem', {
          name: new RegExp(`^${name}`),
          hidden: true,
        })
      ).toBeTruthy();
    }
    for (const name of [
      'Document details changed',
      'Message edited',
      'Attachment added',
    ]) {
      fireEvent.input(search, { target: { value: name } });
      expect(
        screen.queryByRole('menuitem', {
          name: new RegExp(`^${name}`),
          hidden: true,
        })
      ).toBeNull();
    }
    fireEvent.input(search, { target: { value: 'Task created' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add trigger' })).getByRole(
        'button',
        { name: 'Add trigger' }
      )
    );
    chooseTrigger('Email', 'New email received');
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add trigger' })).getByRole(
        'button',
        { name: 'Add trigger' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /Create routine/i }));
    await waitFor(() => expect(host.create).toHaveBeenCalledTimes(1));
    expect(host.create.mock.calls[0][0]).toMatchObject({
      trigger: {
        type: 'events',
        filters: [
          { events: ['task.created'] },
          { events: ['email.message_received'] },
        ],
      },
    });
  });

  it('saves an email trigger with an only-run-if condition', async () => {
    host.create.mockImplementation(async (body) => created(body));
    await mount();
    inputPrompt();
    chooseTrigger('Email', 'New email received');
    const condition = screen.getByRole('textbox', {
      name: 'Only run if AI says yes',
    });
    expect(condition.getAttribute('placeholder')).toBe(
      'Is this email an invoice or a receipt?'
    );
    fireEvent.input(condition, {
      target: { value: '  Is this email an invoice?  ' },
    });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add trigger' })).getByRole(
        'button',
        { name: 'Add trigger' }
      )
    );
    // The page's trigger reads as a sentence, its condition hanging below.
    expect(
      screen.getByRole('button', {
        name: 'Edit condition: Is this email an invoice?',
      })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Create routine/i }));
    await waitFor(() => expect(host.create).toHaveBeenCalledTimes(1));
    expect(host.create.mock.calls[0][0]).toMatchObject({
      trigger: {
        type: 'events',
        filters: [
          {
            events: ['email.message_received'],
            condition: 'Is this email an invoice?',
          },
        ],
      },
    });
  });

  it('saves a GitHub workflow trigger narrowed to one repository and workflow', async () => {
    host.create.mockImplementation(async (body) => created(body));
    await mount();
    inputPrompt();
    chooseTrigger('GitHub', 'Workflow failed');
    const panel = await screen.findByRole('dialog', { name: 'Add trigger' });
    fireEvent.click(
      within(panel).getByRole('checkbox', { name: 'macro-inc/macro' })
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Add a field test' })
    );
    const fields = within(panel).getAllByRole('textbox', {
      name: 'Payload field',
    });
    fireEvent.input(fields[1], { target: { value: 'workflow_run.name' } });
    const values = within(panel).getAllByRole('textbox', { name: 'Value' });
    fireEvent.input(values[1], { target: { value: 'CI' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add trigger' }));
    expect(
      screen.getByRole('button', { name: 'Change Workflow failed trigger' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Repositories for Workflow failed' })
        .textContent
    ).toContain('macro-inc/macro');
    fireEvent.click(screen.getByRole('button', { name: /Create routine/i }));
    await waitFor(() => expect(host.create).toHaveBeenCalledTimes(1));
    expect(host.create.mock.calls[0][0]).toMatchObject({
      trigger: {
        type: 'events',
        filters: [
          {
            events: ['github'],
            github: {
              events: ['workflow_run'],
              actions: ['completed'],
              repositories: ['macro-inc/macro'],
              includeBots: false,
            },
            match: [
              {
                path: ['workflow_run', 'conclusion'],
                in: ['failure', 'timed_out'],
              },
              { path: ['workflow_run', 'name'], equals: 'CI' },
            ],
          },
        ],
      },
    });
  });

  it('asks to connect GitHub before offering GitHub triggers', async () => {
    host.githubLinked = false;
    await mount();
    inputPrompt();
    press(screen.getByRole('button', { name: 'Add trigger' }), 'Enter');
    press(
      screen.getByRole('menuitem', { name: 'GitHub', hidden: true }),
      'ArrowRight'
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Connect GitHub',
        hidden: true,
      })
    );
    expect(
      screen.queryByRole('menuitem', {
        name: /^Workflow failed/,
        hidden: true,
      })
    ).toBeNull();
    expect(host.connectGithub).toHaveBeenCalledOnce();
  });

  it('keeps trigger edits local until confirmed and leaves an add chip', async () => {
    await mount();
    const editor = inputPrompt();
    await addScheduled();
    fireEvent.click(screen.getByRole('button', { name: /^Edit Every day at/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Run time' }), {
      target: { value: '3:30pm' },
    });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Edit trigger' })).getByRole(
        'button',
        { name: 'Cancel' }
      )
    );
    expect(
      screen.getByRole('button', { name: 'Edit Every day at 9:00 AM trigger' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Edit Every day at/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Run time' }), {
      target: { value: '3:30pm' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      screen.getByRole('button', { name: 'Edit Every day at 3:30 PM trigger' })
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add trigger' })).toHaveLength(
      1
    );
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    expect(host.editorMount).toHaveBeenCalledOnce();
  });

  it('creates a one-off routine from a relative date phrase', async () => {
    host.create.mockImplementation(async (body) => created(body));
    await mount();
    inputPrompt();
    const before = Date.now();
    chooseTrigger('Schedule', 'Once');
    const date = screen.getByRole('textbox', { name: 'Run once date' });
    fireEvent.input(date, { target: { value: 'in 2 hours' } });
    fireEvent.keyDown(date, { key: 'Enter' });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add trigger' })).getByRole(
        'button',
        { name: 'Add trigger' }
      )
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    create();
    await waitFor(() => expect(host.create).toHaveBeenCalledOnce());
    const body = host.create.mock.calls[0][0];
    if (!('trigger' in body)) throw new Error('Expected a tagged trigger');
    const trigger = body.trigger;
    expect(trigger.type).toBe('cron');
    if (trigger.type !== 'cron') throw new Error('Expected one-off cron');
    const at = onceFromCron(trigger.schedule, trigger.timezone)?.onceAt;
    expect(at).toBeDefined();
    const scheduled = new Date(at!).getTime();
    expect(scheduled).toBeGreaterThanOrEqual(
      before + 2 * 60 * 60 * 1000 - 1000
    );
    expect(scheduled).toBeLessThanOrEqual(Date.now() + 2 * 60 * 60 * 1000);
  });

  it('configures one-off dates and the calendar in the same panel', async () => {
    await mount();
    inputPrompt();
    chooseTrigger('Schedule', 'Once');
    const panel = screen.getByRole('dialog', { name: 'Add trigger' });
    const confirm = () =>
      within(panel).getByRole('button', { name: 'Add trigger' });
    fireEvent.click(confirm());
    expect(within(panel).getByRole('alert').textContent).toMatch(
      /Choose a date/
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Custom date and time…' })
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Add trigger' })).toBe(panel);
    fireEvent.click(
      screen.getByRole('button', { name: 'Type a date instead' })
    );
    fireEvent.input(screen.getByRole('textbox', { name: 'Run once date' }), {
      target: { value: 'tomorrow 10am' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Tomorrow/ }));
    fireEvent.click(confirm());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Edit .*10:00 AM trigger/ })
    ).toBeTruthy();
    cleanup();
    expect(loadRoutineComposerDraft()?.triggers).toMatchObject([
      { kind: 'schedule', frequency: 'once', onceAt: expect.any(String) },
    ]);
    const trigger = loadRoutineComposerDraft()?.triggers?.[0];
    if (trigger?.kind !== 'schedule') throw new Error('Expected one-off');
    const date = new Date(trigger.onceAt);
    expect(date.getTime()).toBeGreaterThan(Date.now());
    expect(date.getHours()).toBe(10);
  });

  it('removes one trigger and restores the others after closing', async () => {
    await mount();
    inputPrompt();
    await addScheduled('Daily');
    await addDocumentEvent();
    fireEvent.click(screen.getByRole('button', { name: /^Edit Every day at/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove trigger' }));
    cleanup();
    await mount();
    expect(
      screen.getByRole('button', { name: 'Change Document created trigger' })
    ).toBeTruthy();
    expect(loadRoutineComposerDraft()?.triggers).toMatchObject([
      { kind: 'event', events: ['document.created'] },
    ]);
  });
});

describe('new routine', () => {
  function openNewRoutine() {
    const client = new QueryClient();
    render(() => (
      <QueryClientProvider client={client}>
        <RoutineCreator onStart={host.started} />
      </QueryClientProvider>
    ));
  }

  it('starts a template on the new routine’s page, unsaved', async () => {
    openNewRoutine();
    expect(screen.queryByRole('button', { name: 'Create routine' })).toBeNull();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Start a routine from Morning brief',
      })
    );
    expect(host.started).toHaveBeenCalledOnce();
    expect(host.create).not.toHaveBeenCalled();
    cleanup();
    await mount();
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Routine name' })
        .value
    ).toBe('Morning brief');
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Instructions' })
        .value
    ).toMatch(/Summarize my day/);
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: 'Routine description',
      }).value
    ).toBe('Weekdays at 9, sum up my day');
  });

  it('offers no templates while Macro’s templates are flagged off', async () => {
    host.flags.delete('enable-routine-starter-templates');
    openNewRoutine();
    await screen.findByRole('button', { name: 'Start fresh' });
    expect(screen.queryByRole('region', { name: 'Templates' })).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Start a routine from Morning brief',
      })
    ).toBeNull();
  });

  it('starts fresh on a blank page', async () => {
    openNewRoutine();
    fireEvent.click(await screen.findByRole('button', { name: 'Start fresh' }));
    expect(host.started).toHaveBeenCalledOnce();
    expect(loadRoutineComposerDraft()).toMatchObject({
      name: '',
      triggers: [],
      steps: [],
    });
  });

  it('discards the draft on Cancel', async () => {
    await mount();
    inputPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(host.cancelled).toHaveBeenCalledOnce();
    expect(loadRoutineComposerDraft()).toBeNull();
  });
});
