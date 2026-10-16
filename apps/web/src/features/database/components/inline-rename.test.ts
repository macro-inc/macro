import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInlineRename } from './inline-rename';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

describe('createInlineRename', () => {
  it('begins with the current name as a selected, focused draft', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    const select = vi.spyOn(input, 'select');
    const rename = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createInlineRename({
        name: (target: { id: string; name: string }) => target.name,
        rename: () => okAsync(undefined),
        failureMessage: (failure: string) => failure,
        emptyName: { message: 'Enter a name.', onBlur: 'keep-editing' },
        input: () => input,
        restoreFocus: vi.fn(),
      });
    });
    rename.setError('Left over');
    rename.begin({ id: 'tasks', name: 'Tasks' });
    expect(rename.target()).toEqual({ id: 'tasks', name: 'Tasks' });
    expect(rename.draft()).toBe('Tasks');
    expect(rename.error()).toBe('');
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(select).toHaveBeenCalledOnce();
  });

  it('asks for a name when the draft is empty, on Enter and on blur', async () => {
    const onRename = vi.fn(() => okAsync(undefined));
    const rename = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createInlineRename({
        name: (target: { id: string; name: string }) => target.name,
        rename: onRename,
        failureMessage: (failure: string) => failure,
        emptyName: { message: 'Enter a table name.', onBlur: 'keep-editing' },
        input: () => undefined,
        restoreFocus: vi.fn(),
      });
    });
    rename.begin({ id: 'tasks', name: 'Tasks' });
    rename.setDraft('   ');
    await rename.save(true);
    expect(rename.error()).toBe('Enter a table name.');
    rename.setDraft('');
    expect(rename.error()).toBe('');
    await rename.save(false);
    expect(rename.error()).toBe('Enter a table name.');
    expect(rename.target()).toEqual({ id: 'tasks', name: 'Tasks' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('drops a name emptied before blurring when the policy cancels, but asks on Enter', async () => {
    const onRename = vi.fn(() => okAsync(undefined));
    const restoreFocus = vi.fn();
    const rename = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createInlineRename({
        name: (target: { id: string; name: string }) => target.name,
        rename: onRename,
        failureMessage: (failure: string) => failure,
        emptyName: { message: 'Enter a column name.', onBlur: 'cancel' },
        input: () => undefined,
        restoreFocus,
      });
    });
    rename.begin({ id: 'due', name: 'Due' });
    rename.setDraft('');
    await rename.save(true);
    expect(rename.error()).toBe('Enter a column name.');
    await rename.save(false);
    expect(rename.target()).toBeUndefined();
    expect(rename.error()).toBe('');
    await Promise.resolve();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('refuses a name the validation rejects without sending it', async () => {
    const onRename = vi.fn(() => okAsync(undefined));
    const rename = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createInlineRename({
        name: (target: { id: string; name: string }) => target.name,
        rename: onRename,
        failureMessage: (failure: string) => failure,
        emptyName: { message: 'Enter a table name.', onBlur: 'keep-editing' },
        validate: (name) =>
          name === 'Projects'
            ? 'A table with this name already exists.'
            : undefined,
        input: () => undefined,
        restoreFocus: vi.fn(),
      });
    });
    rename.begin({ id: 'tasks', name: 'Tasks' });
    rename.setDraft(' Projects ');
    await rename.save(true);
    expect(rename.error()).toBe('A table with this name already exists.');
    expect(rename.target()).toEqual({ id: 'tasks', name: 'Tasks' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('finishes without sending an unchanged name, restoring focus only when asked', async () => {
    const onRename = vi.fn(() => okAsync(undefined));
    const restoreFocus = vi.fn();
    const rename = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createInlineRename({
        name: (target: { id: string; name: string }) => target.name,
        rename: onRename,
        failureMessage: (failure: string) => failure,
        emptyName: { message: 'Enter a view name.', onBlur: 'keep-editing' },
        input: () => undefined,
        restoreFocus,
      });
    });
    rename.begin({ id: 'work', name: 'My work' });
    rename.setDraft(' My work ');
    await rename.save(false);
    expect(rename.target()).toBeUndefined();
    await Promise.resolve();
    expect(restoreFocus).not.toHaveBeenCalled();

    rename.begin({ id: 'work', name: 'My work' });
    await rename.save(true);
    expect(rename.target()).toBeUndefined();
    await Promise.resolve();
    expect(restoreFocus).toHaveBeenCalledExactlyOnceWith({
      id: 'work',
      name: 'My work',
    });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('sends the trimmed name once, is pending until it settles, then finishes', async () => {
    let settle!: () => void;
    const onRename = vi.fn(
      (_target: { id: string; name: string }, _name: string) =>
        ResultAsync.fromSafePromise(
          new Promise<void>((resolve) => {
            settle = resolve;
          })
        )
    );
    const restoreFocus = vi.fn();
    const rename = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createInlineRename({
        name: (target: { id: string; name: string }) => target.name,
        rename: onRename,
        failureMessage: (failure: string) => failure,
        emptyName: { message: 'Enter a view name.', onBlur: 'keep-editing' },
        input: () => undefined,
        restoreFocus,
      });
    });
    rename.begin({ id: 'work', name: 'My work' });
    rename.setDraft('  Our work ');
    const saving = rename.save(true);
    expect(rename.pending()).toBe(true);
    await rename.save(true);
    rename.cancel(true);
    rename.begin({ id: 'other', name: 'Other' });
    expect(rename.target()).toEqual({ id: 'work', name: 'My work' });
    expect(onRename).toHaveBeenCalledExactlyOnceWith(
      { id: 'work', name: 'My work' },
      'Our work'
    );
    settle();
    await saving;
    expect(rename.pending()).toBe(false);
    expect(rename.target()).toBeUndefined();
    await Promise.resolve();
    expect(restoreFocus).toHaveBeenCalledExactlyOnceWith({
      id: 'work',
      name: 'My work',
    });
  });

  it('keeps the draft and says why when the rename fails', async () => {
    const restoreFocus = vi.fn();
    const rename = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createInlineRename({
        name: (target: { id: string; name: string }) => target.name,
        rename: () => errAsync('conflict'),
        failureMessage: (failure: string) =>
          failure === 'conflict' ? 'Someone renamed it first.' : failure,
        emptyName: { message: 'Enter a view name.', onBlur: 'keep-editing' },
        input: () => undefined,
        restoreFocus,
      });
    });
    rename.begin({ id: 'work', name: 'My work' });
    rename.setDraft('Our work');
    await rename.save(true);
    expect(rename.pending()).toBe(false);
    expect(rename.error()).toBe('Someone renamed it first.');
    expect(rename.target()).toEqual({ id: 'work', name: 'My work' });
    expect(rename.draft()).toBe('Our work');
    await Promise.resolve();
    expect(restoreFocus).not.toHaveBeenCalled();
  });
});
