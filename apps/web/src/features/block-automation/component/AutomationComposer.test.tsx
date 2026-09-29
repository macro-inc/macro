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
import { buildAgentRoster } from '../../agents-view/core/roster';
import { loadAutomationComposerDraft } from '../util/automationComposerStorage';
import {
  AutomationComposer,
  automationComposerOpen,
  setAutomationComposerOpen,
} from './AutomationComposer';
import { getDefaultTimezone } from './automationUtils';

const host = vi.hoisted(() => ({
  create: vi.fn<(body: CreateScheduledAction) => Promise<ScheduledAction>>(),
  openWithSplit: vi.fn(),
  success: vi.fn(),
  alert: vi.fn(),
  editorMount: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: host.openWithSplit }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: host.success, alert: host.alert },
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('../../agents-view/primitives/open-page', () => ({
  openAgentsPage: vi.fn(),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New automation',
}));
vi.mock('@queries/agent-schedule/schedules', async () => {
  const { useMutation } = await import('@tanstack/solid-query');
  return {
    useCreateScheduleMutation: (callbacks: {
      onSuccess: (schedule: ScheduledAction) => Promise<void>;
      onError: (error: Error) => void;
    }) => useMutation(() => ({ mutationFn: host.create, ...callbacks })),
  };
});

// Keep the real dialog, picker, model discovery adapter, storage, and mutation
// lifecycle. The editor double exposes initialValue and detects any remount.
vi.mock('./AutomationPromptEditor', () => ({
  AutomationPromptEditor: (props: {
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
vi.mock('./AutomationTimePicker', () => ({
  AutomationTimePicker: (props: {
    value: string;
    onChange: (value: string) => void;
  }): JSX.Element => (
    <input
      aria-label="Time"
      value={props.value}
      onInput={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
}));

const agentId = '12345678-1234-1234-1234-123456789abc';
const [catalogState, setCatalogState] = createSignal<
  'pending' | 'success' | 'error'
>('success');
vi.mock('../../agents-view/queries/agent-roster-source', () => ({
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
  useAgentModelsQueries: () => [
    {
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
        if (catalogState() !== 'success')
          throw new Error('Unsafe catalog read');
        return {
          status: 'available',
          models: [
            { id: 'claude-sonnet-4-6', name: 'Sonnet' },
            { id: 'vendor/custom-model', name: 'Custom model' },
          ],
        };
      },
    },
  ],
}));

let styles: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setAutomationComposerOpen(false, false);
  setCatalogState('success');
  styles = document.createElement('style');
  styles.textContent = '* { animation-name: none; transition-duration: 0s; }';
  document.head.append(styles);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  setAutomationComposerOpen(false, false);
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
      <button onClick={() => setAutomationComposerOpen(true)}>
        New routine
      </button>
      <AutomationComposer />
    </QueryClientProvider>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
  await screen.findByRole('dialog');
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
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
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

describe('automation composer execution selection', () => {
  it.each(['model', 'agent', 'override'] as const)(
    'submits a %s target with unchanged cron and timezone behavior',
    async (target) => {
      host.create.mockImplementation(async (body) => created(body));
      await mount();
      inputPrompt('  Summarize updates  ');
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
          schedule: '0 0 9 * * 2,3,4,5,6',
          timezone: getDefaultTimezone(),
        },
      });
      await waitFor(() => expect(automationComposerOpen()).toBe(false));
      expect(host.openWithSplit).toHaveBeenCalledWith(
        { type: 'automation', id: 'new-routine' },
        { referredFrom: 'launcher' }
      );
    }
  );

  it('restores the latest selection and prompt even when closed before the save timer', async () => {
    await mount();
    inputPrompt();
    await selectTarget('override');
    vi.useFakeTimers();
    inputPrompt('Last keystroke');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(loadAutomationComposerDraft()).toMatchObject({
      prompt: 'Last keystroke',
      target: { kind: 'agent', agentId, modelOverride: 'vendor/custom-model' },
    });
    setAutomationComposerOpen(true);
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Instructions' })
        .value
    ).toBe('Last keystroke');
    expect(screen.getByRole('button', { name: 'Agent' }).textContent).toContain(
      'Researcher'
    );
    vi.advanceTimersByTime(500);
    expect(loadAutomationComposerDraft()?.target).toEqual({
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
    await selectTarget('agent');
    create();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The selected agent is unavailable.'
    );
    expect(automationComposerOpen()).toBe(true);
    await screen.findByRole('button', { name: 'Create' });
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(loadAutomationComposerDraft()?.target).toEqual({
      kind: 'agent',
      agentId,
    });
    setAutomationComposerOpen(true);
    create();
    await waitFor(() => expect(host.create).toHaveBeenCalledTimes(2));
    expect(host.create.mock.calls[1][0]).toEqual(host.create.mock.calls[0][0]);
    await waitFor(() => expect(automationComposerOpen()).toBe(false));
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
    expect(automationComposerOpen()).toBe(false);
    expect(loadAutomationComposerDraft()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadAutomationComposerDraft()).toBeNull();
    setAutomationComposerOpen(true);
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

  it('preserves validation for empty instructions, invalid time, weekdays, and monthly day', async () => {
    await mount();
    create();
    expect(screen.getByText('Prompt is required.')).toBeTruthy();
    inputPrompt();
    fireEvent.input(screen.getByRole('textbox', { name: 'Time' }), {
      target: { value: '25:00' },
    });
    create();
    expect(screen.getByText('Choose a valid time.')).toBeTruthy();
    fireEvent.input(screen.getByRole('textbox', { name: 'Time' }), {
      target: { value: '09:00' },
    });
    for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    create();
    expect(screen.getByText('Select at least one day.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Every month' }));
    fireEvent.input(screen.getByRole('spinbutton'), {
      target: { value: '32' },
    });
    create();
    expect(screen.getByText('Pick a day between 1 and 31.')).toBeTruthy();
    expect(host.create).not.toHaveBeenCalled();
  });

  it('keeps default dialog autofocus on opening and reopening', async () => {
    await mount();
    const firstControl = screen.getByRole('button', { name: 'Dismiss' });
    await waitFor(() => expect(document.activeElement).toBe(firstControl));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    setAutomationComposerOpen(true);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Dismiss' })
      )
    );
  });
});
