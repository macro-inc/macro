import { NOOP_SPAN } from '@macro-inc/observability';
import type {
  RoutineTask,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import {
  beginInteraction,
  events,
  mocks,
  openActions,
  parent,
  Routine,
  remind,
  runButton,
  setListStatus,
  setSchedules,
  usePending,
} from './tests/routine-detail-test-support';

describe('scheduled copies', () => {
  const copy: ScheduledAction = {
    ...events,
    id: 'routine-id',
    name: 'Remind me',
    trigger: { type: 'once', at: '2026-12-01T09:00:00Z' },
    task: { sub_routine: 'remind', inputs: { taskId: 'Ship the deck' } },
    sub_routine: { parent_id: 'parent-id', created_by_run_id: 'run-1' },
  };

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

  it('marks a cold parent-definition phase failed when the list read fails', () => {
    setSchedules([copy]);
    setListStatus('pending');
    render(() => <Routine />);
    const phase = vi
      .mocked(usePending)
      .mock.calls.find(([name]) => name === 'routine.parent_definition');
    expect(phase?.[1]()).toBe(true);
    setListStatus('error');
    expect(phase?.[1]()).toBe('error');
    expect(
      screen.getByRole('button', { name: 'Retry definition' })
    ).toBeTruthy();
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
    fireEvent.click(retry);
    expect(mocks.refetchList).toHaveBeenCalledOnce();
    expect(screen.getByRole('group', { name: 'Remind me' })).toBeTruthy();
  });

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
