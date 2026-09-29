import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { dueDate, dueValue, fakeCommands } from '../tests/fixtures';
import { createProjectComposer, failedProjectDraft } from './create-project';

describe('project composer', () => {
  it('submits once, defaulting team sharing and leaving unset properties to the server', () =>
    createRoot(async (dispose) => {
      const service = fakeCommands();
      const composer = createProjectComposer(service);
      composer.setName('  Release  ');
      const submission = composer.submit();
      expect(composer.submitted()).toBe(true);
      expect(composer.submit()).toBeUndefined();
      expect(service.create).toHaveBeenCalledOnce();
      expect(service.create).toHaveBeenCalledWith({
        name: 'Release',
        shareWithTeam: true,
        properties: [],
        createdId: undefined,
      });
      expect(submission?.draft).toEqual({
        name: '  Release  ',
        shareWithTeam: true,
        properties: [],
        createdId: undefined,
      });
      expect(await submission?.result).toEqual({
        status: 'created',
        id: 'project',
      });
      dispose();
    }));

  it('does not submit an unnamed project', () =>
    createRoot((dispose) => {
      const service = fakeCommands();
      const composer = createProjectComposer(service);
      composer.setName('   ');
      expect(composer.submit()).toBeUndefined();
      expect(composer.submitted()).toBe(false);
      expect(service.create).not.toHaveBeenCalled();
      dispose();
    }));

  it('retries properties on the project a reopened draft already created', () =>
    createRoot((dispose) => {
      const service = fakeCommands();
      const composer = createProjectComposer(service, {
        name: 'Release',
        shareWithTeam: false,
        properties: [{ property: dueDate, value: dueValue }],
        createdId: 'project',
        error: 'Retry',
      });
      composer.clear();
      expect(composer.name()).toBe('Release');
      composer.submit();
      expect(service.create).toHaveBeenCalledWith({
        name: 'Release',
        shareWithTeam: false,
        properties: [{ property: dueDate, value: dueValue }],
        createdId: 'project',
      });
      dispose();
    }));
});

describe('failed project draft', () => {
  const draft = {
    name: 'Release',
    shareWithTeam: true,
    properties: [{ property: dueDate, value: dueValue }],
  };

  it('keeps the server message when nothing was created', () => {
    expect(
      failedProjectDraft(draft, {
        status: 'failed',
        error: new Error('Name is too long'),
      })
    ).toEqual({ ...draft, error: 'Name is too long' });
  });

  it('keeps the created id when only properties failed, so retry cannot duplicate it', () => {
    expect(
      failedProjectDraft(draft, {
        status: 'propertiesFailed',
        id: 'project',
        error: new Error('offline'),
      })
    ).toEqual({
      ...draft,
      createdId: 'project',
      error: expect.stringContaining('Retry'),
    });
  });
});
