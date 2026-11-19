import FileTextIcon from '@icon/system/regular/file-text.svg';
import { NOOP_SPAN } from '@macro-inc/observability';
import type {
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
import { ResultAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { RoutineTarget } from './core/routine-target';

import {
  activationItem,
  agentTarget,
  cron,
  deferredSave,
  events,
  mocks,
  openActions,
  openDeleteModal,
  openRunOptions,
  Routine,
  runButton,
  selectedTarget,
  setActivationPending,
  setSchedules,
  setStatus,
  toast,
} from './tests/routine-detail-test-support';

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

  it('counts for Delete the sub-routines a fresh children read finds', async () => {
    const read = Promise.withResolvers<ScheduledAction[]>();
    mocks.fetchChildren.mockReturnValueOnce(
      ResultAsync.fromSafePromise(read.promise)
    );
    render(() => <Routine />);
    openActions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete' }), {
      key: 'Enter',
    });
    expect(mocks.fetchChildren).toHaveBeenCalledExactlyOnceWith('routine-id');
    const options = vi.mocked(openDeleteModal).mock.calls.at(-1)?.[0];
    // The page's list holds none, so until the read answers the note says
    // any it created go too: confirming now still warns.
    expect(options?.note).toBe('Any routines it created will be deleted too.');
    // The read finds the ones a run just made.
    read.resolve([
      { ...cron, id: 'a' },
      { ...cron, id: 'b' },
    ]);
    await vi.waitFor(() =>
      expect(options?.note).toBe(
        'The 2 routines it created will be deleted too.'
      )
    );
  });

  it('reads nothing for Delete of a sub-routine, which creates none of its own', () => {
    setSchedules([
      {
        ...cron,
        sub_routine: { parent_id: 'parent-id', created_by_run_id: 'run-1' },
      },
    ]);
    render(() => <Routine />);
    openActions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete' }), {
      key: 'Enter',
    });
    expect(mocks.fetchChildren).not.toHaveBeenCalled();
    const options = vi.mocked(openDeleteModal).mock.calls.at(-1)?.[0];
    expect(options?.note).toBeUndefined();
  });

  it('duplicates the saved task when its steps cannot open in the editor', () => {
    const saved: ScheduledAction = {
      ...cron,
      task: JSON.parse(
        JSON.stringify({
          steps: [{ type: 'future-step', source: 'Work to preserve' }],
        })
      ),
    };
    setSchedules([saved]);
    render(() => <Routine />);
    expect(
      screen.getByText('This routine has an unsupported task configuration.')
    ).toBeTruthy();
    openActions();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Duplicate' }), {
      key: 'Enter',
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      body: expect.objectContaining({
        task: saved.task,
        trigger: saved.trigger,
      }),
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

describe('routine icon', () => {
  const satellite = {
    icon: { kind: 'emoji', value: '🛰️' },
    color: 'teal',
  } satisfies ScheduledAction['appearance'];

  /** The glyph the page's header draws for the routine, and the top bar's. */
  function icons() {
    const header = screen.getByLabelText('Routine name').closest('header');
    const crumb = within(screen.getByLabelText('Routine location'))
      .getByText('Summary')
      .closest('div');
    const page = header?.querySelector('svg, .emoji');
    const top = crumb?.querySelector('svg, .emoji');
    if (!page || !top) throw new Error('A routine icon is missing');
    return { page, top };
  }

  /** The colour a glyph is drawn in. */
  function tint(glyph: Element) {
    return glyph.closest<HTMLElement>('[data-slot="routine-icon"]')?.style
      .color;
  }

  it('shows its trigger’s icon in the header and the top bar when none is chosen', () => {
    setSchedules([events]);
    render(() => <Routine />);
    const { page, top } = icons();
    const { container } = render(() => <FileTextIcon class="size-full" />);
    const fileText = container.innerHTML;
    expect(page.outerHTML).toBe(fileText);
    expect(top.outerHTML).toBe(fileText);
  });

  it('shows the chosen icon in its colour in the header and the top bar', () => {
    setSchedules([{ ...cron, appearance: satellite }]);
    render(() => <Routine />);
    for (const glyph of Object.values(icons())) {
      expect(glyph.textContent).toBe('🛰️');
      expect(tint(glyph)).toBe('rgb(18, 165, 148)');
    }
  });

  it('draws the same icon on the owner’s Change icon button', () => {
    mocks.flags = () => ['enable-entity-appearance'];
    setSchedules([{ ...cron, appearance: satellite }]);
    render(() => <Routine />);
    const { page, top } = icons();
    expect(
      screen.getByRole('button', { name: 'Change icon' }).contains(top)
    ).toBe(true);
    expect(top.outerHTML).toBe(page.outerHTML);
  });
});

describe('routine toolbar on touch', () => {
  it('lets taps reach every control in the top bar', () => {
    mocks.flags = () => ['enable-entity-appearance'];
    setSchedules([cron]);
    render(() => <Routine />);
    const toolbar = screen.getByLabelText('Routine toolbar');
    // A touch top bar floats over the page and ignores taps, except on the
    // parts that take them back.
    const tappable = (control: Element) => {
      for (
        let node: Element | null = control;
        node && node !== toolbar;
        node = node.parentElement
      ) {
        if (
          node.classList.contains('touch:pointer-events-auto') ||
          node.classList.contains('pointer-events-auto')
        )
          return true;
      }
      return false;
    };
    const controls = [
      ...within(toolbar).getAllByRole('button'),
      ...within(toolbar).getAllByRole('tab'),
    ];
    for (const name of [
      'Back to routines',
      'Change icon',
      'Routine actions',
      'Run now',
      'Run options',
    ]) {
      expect(within(toolbar).getByRole('button', { name })).toBeTruthy();
    }
    for (const name of [/^Overview/, /^Runs/]) {
      expect(within(toolbar).getByRole('tab', { name })).toBeTruthy();
    }
    // Nothing around the controls takes taps meant for the page under the bar:
    // not the save status, and no row of the bar but the title island.
    for (const status of within(toolbar).getAllByRole('status')) {
      expect(tappable(status)).toBe(false);
    }
    for (const row of toolbar.children) {
      if (!row.matches('[data-header-island]')) {
        expect(row.className).not.toMatch(/pointer-events-auto/);
      }
    }
    expect(
      controls
        .filter((control) => !tappable(control))
        .map(
          (control) =>
            control.getAttribute('aria-label') ?? control.textContent?.trim()
        )
    ).toEqual([]);
  });
});
