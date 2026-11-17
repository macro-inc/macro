import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from '../components/composer/create-calendar-event-form-controller';
import type { EventEditorSubmitValues } from '../components/composer/event-form-model';
import { defaultEditorInitialValues } from '../components/composer/event-form-model';
import type { ComposerMetadataChanges } from '../core/composer-metadata';
import { createAgentComposer } from './create-agent-composer';

it('uses one validated snapshot and prevents a second decision while execution is pending', async () => {
  const { agent, execute, reject, finish, dispose } = createRoot((dispose) => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T11:00'), false),
        title: 'Draft',
        calendarId: 'work',
      },
      calendarOptions: () => [{ id: 'work', label: 'Work', color: '#333' }],
      guestOptions: () => [],
    });
    let resolveExecution: ((value: boolean) => void) | undefined;
    const execute = vi.fn<(values: { title: string }) => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve) => {
          resolveExecution = resolve;
        })
    );
    const reject = vi.fn(async () => true);
    const agent = createAgentComposer({
      controller,
      timeFormat: '12-hour',
      guestPolicyEditable: true,
      canAct: () => true,
      prepare: (values = controller.submitValues()) => values,
      onExecute: execute,
      onReject: reject,
    });
    return {
      agent,
      execute,
      reject,
      finish: (result: boolean) => resolveExecution?.(result),
      dispose,
    };
  });
  agent.model.submit();
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0][0].title).toBe('Draft');
  expect(agent.model.formIsDisabled()).toBe(true);
  agent.model.submit();
  await agent.cancel();
  expect(execute).toHaveBeenCalledOnce();
  expect(reject).not.toHaveBeenCalled();
  finish(true);
  await Promise.resolve();
  expect(agent.locked()).toBe(true);
  dispose();
});

it('rejects a draft once and never executes it after rejection', async () => {
  const { agent, reject, execute, dispose } = createRoot((dispose) => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T11:00'), false),
        title: 'Draft',
        calendarId: 'work',
      },
      calendarOptions: () => [{ id: 'work', label: 'Work', color: '#333' }],
      guestOptions: () => [],
    });
    const reject = vi.fn(async () => true);
    const execute = vi.fn(async () => true);
    const agent = createAgentComposer({
      controller,
      timeFormat: '12-hour',
      guestPolicyEditable: true,
      canAct: () => true,
      prepare: (values = controller.submitValues()) => values,
      onExecute: execute,
      onReject: reject,
    });
    return { agent, reject, execute, dispose };
  });
  await agent.cancel();
  agent.model.submit();
  await agent.cancel();
  expect(reject).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  dispose();
});

it('keeps unsupported visibility read-only and forwards explicit time-zone metadata', () => {
  createRoot((dispose) => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T11:00'), false),
        title: 'Draft',
        calendarId: 'work',
      },
      calendarOptions: () => [{ id: 'work', label: 'Work', color: '#333' }],
      guestOptions: () => [],
    });
    const prepare = vi.fn(
      (values?: EventEditorSubmitValues, _metadata?: ComposerMetadataChanges) =>
        values
    );
    const agent = createAgentComposer({
      controller,
      timeFormat: '12-hour',
      guestPolicyEditable: true,
      canAct: () => true,
      prepare,
      onExecute: async () => true,
      onReject: async () => true,
    });
    expect(agent.model.visibilityIsDisabled()).toBe(true);
    agent.model.setVisibility('private');
    expect(agent.model.visibility()).toBe('default');
    agent.model.setTimeZone('America/New_York');
    agent.model.submit();
    expect(prepare.mock.calls[0][1]).toEqual({ timeZoneChanged: true });
    dispose();
  });
});

it('keeps a validated snapshot readable when a review stack locks its actions', () => {
  createRoot((dispose) => {
    const [canAct, setCanAct] = createSignal(true);
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T11:00'), false),
        title: 'Stack draft',
        calendarId: 'work',
      },
      calendarOptions: () => [{ id: 'work', label: 'Work', color: '#333' }],
      guestOptions: () => [],
    });
    const execute = vi.fn(async () => true);
    const agent = createAgentComposer({
      controller,
      timeFormat: '12-hour',
      guestPolicyEditable: false,
      canAct,
      prepare: (values) => values,
      onExecute: execute,
      onReject: async () => true,
    });
    agent.model.setTimeZone('America/New_York');
    setCanAct(false);
    expect(agent.model.submission()?.changes).toEqual({
      timeZoneChanged: true,
    });
    expect(agent.model.submission()?.values.title).toBe('Stack draft');
    agent.model.submit();
    expect(execute).not.toHaveBeenCalled();
    dispose();
  });
});
