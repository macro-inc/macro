import { NOOP_SPAN } from '@macro-inc/observability';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import {
  beginInteraction,
  mocks,
  openActions,
  parent,
  Routine,
  remind,
  setSchedules,
} from './tests/routine-detail-test-support';

// An item knob shows its item's name, which needs providers the page
// doesn't mount here.
vi.mock('@property/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@property/hooks')>()),
  usePropertyEntityDisplay: () => ({
    name: () => 'bug-reports',
    icon: () => null,
  }),
}));

describe('routine definitions', () => {
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

  it('marks a knob needing a new pick in the sub-routine holding it, not on the routine step sharing its id', () => {
    const post = (channel: string) => ({
      type: 'code' as const,
      id: 'post',
      title: 'Post',
      source: 'export async function main() {}',
      sentence: 'Post open bugs in {bugs}.',
      knobs: [
        {
          type: 'entity' as const,
          name: 'bugs',
          label: 'Channel to post in',
          entity_types: ['channel' as const],
          value: { type: 'channel' as const, id: channel },
        },
      ],
    });
    setSchedules([
      {
        ...parent,
        task: {
          steps: [post('kept')],
          sub_routines: [{ ...remind, steps: [post('gone')] }],
        },
      },
    ]);
    mocks.unusable = () => [
      {
        sub_routine: 'remind',
        step: 'post',
        knob: 'bugs',
        item: { type: 'channel', id: 'gone' },
        reason: 'Deleted',
      },
    ];
    render(() => <Routine />);
    const needsPick = {
      name: 'Channel to post in: needs a new pick. Set it',
    };
    const definition = within(
      screen.getByRole('region', { name: 'Sub-routines' })
    ).getByRole('group', { name: 'Remind me' });
    expect(within(definition).getByRole('button', needsPick)).toBeTruthy();
    expect(screen.getAllByRole('button', needsPick)).toHaveLength(1);
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
    const remove = screen.getByRole('button', { name: `Remove ${appName}` });
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

  it('keeps the autosave blocked when an agent refetch fails with retained data', async () => {
    const [failed, setFailed] = createSignal(false);
    mocks.agentsFailed = failed;
    mocks.agentsRetained = () => true;
    mocks.connectedApps = () => new Set(['example']);
    setSchedules([
      {
        ...parent,
        id: 'routine-id',
        task: {
          steps: [remind.steps[0]],
          sub_routines: [
            {
              ...remind,
              steps: [
                {
                  type: 'agent',
                  agent: { bot_id: '12345678-1234-1234-1234-123456789abc' },
                  instructions: 'Remind me about the task.',
                },
              ],
              mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
            },
          ],
        },
      },
    ]);
    render(() => <Routine />);
    const editor = within(screen.getByRole('group', { name: 'Remind me' }));
    fireEvent.input(editor.getByRole('textbox', { name: 'Instructions' }), {
      target: { value: 'Remind me tomorrow.' },
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();

    setFailed(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).not.toHaveBeenCalled();

    fireEvent.click(editor.getByLabelText('Execution target'));
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update).toHaveBeenCalledOnce();
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
});
