import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { type ComponentProps, createResource, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAgentRoster,
  type PersistedAgentLike,
} from '../../agents-view/core/roster';
import { createComposerModels } from '../../agents-view/queries/composer-models';
import type { RoutineTarget } from '../core/routine-target';
import { RoutineExecutionPicker } from '../routine-execution-picker';
import {
  RoutineExecutionPickerBoundary,
  RoutineExecutionPickerView,
} from './routine-execution-picker';

const host = vi.hoisted(() => ({
  layout: {},
  openSettings: vi.fn(),
  openAgentsPage: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => host.layout,
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: host.openSettings }),
}));
vi.mock('../../agents-view/primitives/open-page', () => ({
  openAgentsPage: host.openAgentsPage,
}));
vi.mock('../../agents-view/queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({
    roster,
    loading: () => false,
    error: () => false,
    availabilityLoading: () => false,
  }),
}));

// Exercise the real AgentPicker, runtime model adapter, and Kobalte menus.
// Replace discovery and host actions, with no Block or New Chat context.
type Catalog = {
  status: 'pending' | 'error' | 'success';
  models: { id: string; name: string }[];
};
const [catalogs, setCatalogs] = createSignal<Record<string, Catalog>>({});
vi.mock('@queries/agents/models', () => ({
  useAgentModelsQueries: (
    targets: () => { harness: string; harnessId?: string }[]
  ) => {
    const current = () => {
      const target = targets()[0];
      return target
        ? catalogs()[target.harnessId ?? target.harness]
        : undefined;
    };
    return [
      {
        get isSuccess() {
          return current()?.status === 'success';
        },
        get isPending() {
          return current()?.status === 'pending';
        },
        get isError() {
          return current()?.status === 'error';
        },
        get data() {
          if (current()?.status !== 'success')
            throw new Error('Read a pending catalog');
          return { status: 'available', models: current()?.models ?? [] };
        },
      },
    ];
  },
}));

const managedId = '12345678-1234-1234-1234-123456789abc';
const externalId = '12345678-1234-1234-1234-123456789def';
const missingId = '12345678-1234-1234-1234-123456789000';
const managed: PersistedAgentLike = {
  bot: { id: managedId, name: 'Researcher', handle: 'researcher' },
  harness: 'in-memory',
  default_model: 'chat-model',
};
const external: PersistedAgentLike = {
  bot: { id: externalId, name: 'Local worker', handle: 'worker' },
  harness: 'macrod',
  harness_id: 'workstation',
  default_model: 'local-default',
};
function roster(connected = true) {
  return buildAgentRoster({
    agents: [managed, external],
    runtimes: [{ id: 'workstation', name: 'Workstation', connected }],
    cursorConnected: false,
    cursorNeedsConnection: true,
  });
}

type ViewProps = ComponentProps<typeof RoutineExecutionPickerView>;
function mount(target: RoutineTarget, overrides: Partial<ViewProps> = {}) {
  const [selection, setSelection] = createSignal(target);
  const onChange = vi.fn((value: RoutineTarget) => setSelection(value));
  const onConnect = vi.fn();
  const onCreate = vi.fn();
  render(() => (
    <>
      <textarea aria-label="Routine prompt" />
      <RoutineExecutionPickerBoundary target={selection()}>
        <RoutineExecutionPickerView
          target={selection()}
          onChange={onChange}
          roster={roster()}
          rosterLoading={false}
          rosterError={false}
          availabilityLoading={false}
          createModels={createComposerModels}
          onConnect={onConnect}
          onCreate={onCreate}
          {...overrides}
        />
      </RoutineExecutionPickerBoundary>
    </>
  ));
  return { selection, onChange, onConnect, onCreate };
}
function openPicker() {
  const trigger = screen.getByRole('button', { name: 'Agent' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}
async function expectClosed(trigger: HTMLElement) {
  await waitFor(() =>
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  );
  await waitFor(() => expect(document.activeElement).toBe(trigger));
}
async function openModels(name: string) {
  const trigger = openPicker();
  const row = screen.getByRole('menuitem', { name: new RegExp(`^${name}`) });
  row.focus();
  fireEvent.keyDown(row, { key: 'ArrowRight' });
  // The root Macro catalog also has a search box; wait for the agent submenu.
  const menu = await screen.findByRole('menu', {
    name: new RegExp(`^${name}`),
  });
  expect(menu.getAttribute('aria-label')).toBe(`Models for ${name}`);
  await within(menu).findByRole('textbox', { name: 'Search models' });
  return { trigger, menu: within(menu) };
}

let styles: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks();
  setCatalogs({
    'in-memory': {
      status: 'success',
      models: [
        { id: 'chat-model', name: 'Chat model' },
        { id: 'other-model', name: 'Other model' },
      ],
    },
    workstation: {
      status: 'success',
      models: [
        { id: 'local-default', name: 'Local default' },
        { id: 'vendor/custom-model', name: 'Custom model' },
      ],
    },
  });
  styles = document.createElement('style');
  styles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(styles);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  styles.remove();
  vi.unstubAllGlobals();
});

describe('routine execution picker', () => {
  it('selects Macro models with the keyboard and restores trigger focus', async () => {
    const { selection } = mount({
      kind: 'agent',
      agentId: managedId,
      modelOverride: 'old',
    });
    expect(
      screen.getByRole('group', { name: 'Routine model or agent' })
    ).toBeTruthy();
    const trigger = openPicker();
    const item = screen.getByRole('menuitem', { name: 'Other model' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(selection()).toEqual({ kind: 'model', model: 'other-model' });
    await expectClosed(trigger);
    expect(trigger.textContent).toContain('Other model');
  });

  it.each(['Researcher', 'Local worker'])(
    'selects %s directly without inheriting the previous override',
    async (name) => {
      const { selection } = mount({
        kind: 'agent',
        agentId: externalId,
        modelOverride: 'old-model',
      });
      const trigger = openPicker();
      fireEvent.click(
        screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })
      );
      expect(selection()).toEqual({
        kind: 'agent',
        agentId: name === 'Researcher' ? managedId : externalId,
      });
      expect(trigger.textContent).toContain(name);
      await expectClosed(trigger);
    }
  );

  it.each([
    ['Researcher', managedId, 'Other model', 'other-model'],
    ['Local worker', externalId, 'Custom model', 'vendor/custom-model'],
  ])(
    'selects runtime-specific nested models for %s',
    async (name, agentId, label, model) => {
      const { selection } = mount({ kind: 'model', model: 'chat-model' });
      const { trigger, menu } = await openModels(name);
      const item = menu.getByRole('menuitem', { name: label });
      item.focus();
      fireEvent.keyDown(item, { key: 'Enter' });
      expect(selection()).toEqual({
        kind: 'agent',
        agentId,
        modelOverride: model,
      });
      await expectClosed(trigger);
    }
  );

  it.each(['Enter', ' '])(
    'selects an agent default with %j, clearing an override',
    async (key) => {
      const { selection } = mount({
        kind: 'agent',
        agentId: externalId,
        modelOverride: 'old',
      });
      const trigger = openPicker();
      const row = screen.getByRole('menuitem', { name: /^Researcher/ });
      row.focus();
      fireEvent.keyDown(row, { key });
      expect(selection()).toEqual({ kind: 'agent', agentId: managedId });
      await expectClosed(trigger);
    }
  );

  it('wires the production setup actions without a legacy block provider', async () => {
    const onChange = vi.fn();
    render(() => (
      <RoutineExecutionPicker
        target={{ kind: 'model', model: 'chat-model' }}
        onChange={onChange}
      />
    ));
    let trigger = openPicker();
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: /Connect Cursor/ }),
      { key: 'Enter' }
    );
    expect(host.openSettings).toHaveBeenCalledWith('Harness');
    await expectClosed(trigger);
    trigger = openPicker();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Create agent' }), {
      key: 'Enter',
    });
    expect(host.openAgentsPage).toHaveBeenCalledWith(host.layout, 'agents');
    await expectClosed(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a user choice when a late roster reveals the previously saved agent', async () => {
    const [loading, setLoading] = createSignal(true);
    const { selection, onChange } = mount(
      { kind: 'agent', agentId: managedId },
      {
        get roster() {
          return loading()
            ? roster().filter((agent) => agent.botId !== managedId)
            : roster();
        },
        get rosterLoading() {
          return loading();
        },
      }
    );
    const trigger = openPicker();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Other model' }), {
      key: 'Enter',
    });
    await expectClosed(trigger);
    setLoading(false);
    expect(selection()).toEqual({ kind: 'model', model: 'other-model' });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('Escape closes without selecting and restores focus on each opening', async () => {
    const { onChange } = mount({ kind: 'model', model: 'chat-model' });
    for (let i = 0; i < 2; i++) {
      const trigger = openPicker();
      fireEvent.keyDown(document, { key: 'Escape' });
      await expectClosed(trigger);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves a missing agent and override visibly instead of falling back to Macro', () => {
    const { selection, onChange } = mount({
      kind: 'agent',
      agentId: missingId,
      modelOverride: 'saved-model',
    });
    expect(screen.getByText(`Agent: ${missingId} · saved-model`)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'missing or no longer accessible'
    );
    expect(selection()).toEqual({
      kind: 'agent',
      agentId: missingId,
      modelOverride: 'saved-model',
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'model', model: 'retired-model' },
    { kind: 'agent', agentId: externalId, modelOverride: 'retired-model' },
  ] satisfies RoutineTarget[])(
    'keeps an unavailable model in the trigger with a warning: %j',
    (target) => {
      const { onChange } = mount(target);
      expect(
        screen.getByRole('button', { name: 'Agent' }).textContent
      ).toContain('Retired Model');
      expect(screen.getByRole('status').textContent).toContain(
        'not available from this runtime'
      );
      expect(onChange).not.toHaveBeenCalled();
    }
  );

  it('uses roster availability and existing setup callbacks without changing the draft', async () => {
    const { onChange, onConnect, onCreate } = mount(
      { kind: 'agent', agentId: externalId },
      { roster: roster(false) }
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Its runtime is disconnected'
    );
    let trigger = openPicker();
    expect(
      screen
        .getByRole('menuitem', { name: /Local worker/ })
        .getAttribute('aria-disabled')
    ).toBe('true');
    const connect = screen.getByRole('menuitem', { name: /Connect Cursor/ });
    fireEvent.keyDown(connect, { key: 'Enter' });
    expect(onConnect.mock.calls[0][0].harness).toBe('cursor');
    await expectClosed(trigger);
    trigger = openPicker();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Create agent' }), {
      key: 'Enter',
    });
    expect(onCreate).toHaveBeenCalledOnce();
    await expectClosed(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { rosterLoading: true },
    { rosterError: true },
    { availabilityLoading: true },
  ])('does not rewrite saved choices while roster status is %j', (status) => {
    const { onChange } = mount({ kind: 'agent', agentId: managedId }, status);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not read pending catalogs or replace a user choice when discovery resolves', async () => {
    setCatalogs({ 'in-memory': { status: 'pending', models: [] } });
    const { selection, onChange } = mount({
      kind: 'model',
      model: 'saved-model',
    });
    const prompt = screen.getByRole('textbox', { name: 'Routine prompt' });
    fireEvent.input(prompt, { target: { value: 'Keep writing' } });
    expect(screen.getByRole('status').textContent).toContain('Loading models');
    const trigger = openPicker();
    fireEvent.click(screen.getByRole('menuitem', { name: /Researcher/ }));
    await expectClosed(trigger);
    setCatalogs({
      'in-memory': {
        status: 'success',
        models: [{ id: 'later-model', name: 'Later model' }],
      },
    });
    expect(selection()).toEqual({ kind: 'agent', agentId: managedId });
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Routine prompt' })).toBe(
      prompt
    );
    expect((prompt as HTMLTextAreaElement).value).toBe('Keep writing');
  });

  it('retains a saved model when discovery fails or returns an empty catalog', () => {
    setCatalogs({ 'in-memory': { status: 'error', models: [] } });
    const { onChange } = mount({ kind: 'model', model: 'saved-model' });
    expect(screen.getByRole('status').textContent).toContain(
      'Could not load models'
    );
    setCatalogs({ 'in-memory': { status: 'success', models: [] } });
    expect(screen.getByRole('status').textContent).toContain(
      'returned no models'
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('bounds unexpected discovery errors locally and offers retry without touching the prompt', () => {
    let failed = true;
    const { onChange } = mount(
      { kind: 'model', model: 'saved-model' },
      {
        createModels(agent) {
          if (failed) throw new Error('Discovery failed');
          return createComposerModels(agent);
        },
      }
    );
    const prompt = screen.getByRole('textbox', { name: 'Routine prompt' });
    fireEvent.input(prompt, { target: { value: 'Preserved prompt' } });
    expect(screen.getByRole('status').textContent).toContain(
      'Model: saved-model'
    );
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry choices' }));
    expect(screen.getByRole('button', { name: 'Agent' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Routine prompt' })).toBe(
      prompt
    );
    expect((prompt as HTMLTextAreaElement).value).toBe('Preserved prompt');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('bounds suspension locally so a pending discovery cannot detach the prompt', async () => {
    let resolve!: (models: { id: string }[]) => void;
    const { onChange } = mount(
      { kind: 'model', model: 'saved-model' },
      {
        createModels() {
          const [models] = createResource(
            () =>
              new Promise<{ id: string }[]>((done) => {
                resolve = done;
              })
          );
          return {
            models: () => models() ?? [],
            message: () => 'Loading models',
          };
        },
      }
    );
    const prompt = screen.getByRole('textbox', { name: 'Routine prompt' });
    fireEvent.input(prompt, { target: { value: 'Still here' } });
    expect(screen.getByRole('status').textContent).toContain(
      'Loading model and agent choices'
    );
    resolve([{ id: 'saved-model' }]);
    await screen.findByRole('button', { name: 'Agent' });
    expect(screen.getByRole('textbox', { name: 'Routine prompt' })).toBe(
      prompt
    );
    expect((prompt as HTMLTextAreaElement).value).toBe('Still here');
    expect(onChange).not.toHaveBeenCalled();
  });
});
