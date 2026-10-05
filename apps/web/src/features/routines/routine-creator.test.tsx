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

const host = vi.hoisted(() => ({
  create: vi.fn<(body: CreateScheduledAction) => Promise<ScheduledAction>>(),
  openWithSplit: vi.fn(),
  created: vi.fn(),
  success: vi.fn(),
  alert: vi.fn(),
  editorMount: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: host.openWithSplit }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { close: vi.fn() } }),
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

let styles: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setCatalogState('success');
  styles = document.createElement('style');
  styles.textContent = '* { animation-name: none; transition-duration: 0s; }';
  document.head.append(styles);
  vi.stubGlobal('scrollTo', vi.fn());
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
      <RoutineCreator onCreated={host.created} />
    </QueryClientProvider>
  ));
  await screen.findByRole('textbox', { name: 'Routine name' });
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
async function addScheduled(name = 'Daily') {
  const add = screen.getByRole('button', { name: 'Add trigger' });
  fireEvent.click(add);
  fireEvent.click(await screen.findByRole('button', { name: 'Scheduled' }));
  fireEvent.click(await screen.findByRole('button', { name }));
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
  fireEvent.click(add);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Document created' })
  );
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
    }
  );

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
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    for (const name of ['Channels', 'Documents', 'Tasks', 'Email']) {
      expect(await screen.findByText(name)).toBeTruthy();
    }
    for (const name of [
      'Scheduled',
      'Run once',
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
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    for (const name of [
      'Document details changed',
      'Message edited',
      'Attachment added',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Task created' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add trigger' })).getByRole(
        'button',
        { name: 'Add trigger' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    fireEvent.click(screen.getByRole('button', { name: 'New email received' }));
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

  it('keeps trigger edits local until confirmed and leaves an add chip', async () => {
    await mount();
    const editor = inputPrompt();
    await addScheduled();
    fireEvent.click(screen.getByRole('button', { name: /^Edit Every day,/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Run time' }), {
      target: { value: '3:30pm' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Edit Every day, 9:00 AM trigger' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Edit Every day,/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Run time' }), {
      target: { value: '3:30pm' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      screen.getByRole('button', { name: 'Edit Every day, 3:30 PM trigger' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));
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
    fireEvent.click(screen.getByRole('button', { name: /^Edit Every day,/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove trigger' }));
    cleanup();
    await mount();
    expect(
      screen.getByRole('button', { name: 'Edit Document created trigger' })
    ).toBeTruthy();
    expect(loadRoutineComposerDraft()?.triggers).toMatchObject([
      { kind: 'event', events: ['document.created'] },
    ]);
  });
});
