import { NOOP_SPAN, type Span } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type {
  CodeUpgrade,
  RoutineTask,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { scheduledActionKeys } from './queries/keys';

import {
  beginInteraction,
  cron,
  mocks,
  Routine,
  setSchedules,
  toast,
} from './routine-detail-test-support';

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

  it('retains a newer detail response received while the approval GET was pending', async () => {
    const reply = Promise.withResolvers<ScheduledAction>();
    const newer: ScheduledAction = {
      ...paused,
      configuration_revision: paused.configuration_revision + 1,
      task: {
        steps: [{ type: 'agent', model: 'm', instructions: 'Summarize' }],
      },
    };
    let current = paused;
    setSchedules([paused]);
    mocks.codeUpgrades = () => [
      upgrade(code('macro.tasks.add(x)', '0.3.0+new')),
    ];
    mocks.realRoutineQuery = true;
    mocks.getRoutine.mockImplementation(async (_id, options) =>
      ok(options?.cache === 'no-store' ? await reply.promise : current)
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
      expect(mocks.getRoutine).toHaveBeenCalledWith('routine-id', {
        cache: 'no-store',
      });
      current = newer;
      await queryClient.refetchQueries({ queryKey: key, exact: true });
      expect(queryClient.getQueryData(key)).toEqual(newer);

      reply.resolve(paused);
      await vi.advanceTimersByTimeAsync(0);
      expect(queryClient.getQueryData(key)).toEqual(newer);
      expect(
        screen.queryByRole('button', { name: 'Approve and resume' })
      ).toBeNull();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.setEnabled).not.toHaveBeenCalled();
      expect(toast.alert).toHaveBeenCalledWith(
        'Could not check the current routine before approving'
      );
    } finally {
      unmount();
      queryClient.removeQueries({ queryKey: key });
    }
  });

  it('keeps a newer list record when detail is still loading during approval', async () => {
    const reply = Promise.withResolvers<ScheduledAction>();
    const detail = Promise.withResolvers<ScheduledAction>();
    const newer: ScheduledAction = {
      ...paused,
      configuration_revision: paused.configuration_revision + 1,
      name: 'Updated from another editor',
    };
    setSchedules([paused]);
    mocks.codeUpgrades = () => [
      upgrade(code('macro.tasks.add(x)', '0.3.0+new')),
    ];
    mocks.realRoutineQuery = true;
    mocks.getRoutine.mockImplementation(async (_id, options) =>
      ok(await (options?.cache === 'no-store' ? reply.promise : detail.promise))
    );
    const listKey = scheduledActionKeys.list.queryKey;
    const detailKey = scheduledActionKeys.detail({
      scheduleId: 'routine-id',
    }).queryKey;
    const { unmount } = render(() => (
      <QueryClientProvider client={queryClient}>
        <Routine />
      </QueryClientProvider>
    ));
    try {
      fireEvent.click(
        screen.getByRole('button', { name: 'Approve and resume' })
      );
      expect(mocks.getRoutine).toHaveBeenCalledWith('routine-id', {
        cache: 'no-store',
      });
      queryClient.setQueryData(listKey, [newer]);
      setSchedules([newer]);
      reply.resolve(paused);
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.setEnabled).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(detailKey)).toBeUndefined();
      expect(queryClient.getQueryData(listKey)).toEqual([newer]);
      expect(toast.alert).toHaveBeenCalledWith(
        'Could not check the current routine before approving'
      );
    } finally {
      unmount();
      queryClient.removeQueries({ queryKey: detailKey });
      queryClient.removeQueries({ queryKey: listKey });
      detail.resolve(newer);
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
