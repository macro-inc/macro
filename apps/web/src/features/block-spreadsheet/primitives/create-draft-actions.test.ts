import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDraftActions } from './create-draft-actions';

let dispose = () => {};
afterEach(() => dispose());

function fixture() {
  const context = { sheetId: 'sheet1', sheetName: 'Budget', range: 'B4:C9' };
  const options = {
    snapshot: vi.fn(() => new Uint8Array([1, 2, 3])),
    context: vi.fn(() => context),
    createDocument: vi.fn(async () => 'document-id'),
    saveDocument: vi.fn(async () => {}),
    openChat: vi.fn(async () => true),
    openDocument: vi.fn(),
    onSaveFailure: vi.fn(),
  };
  const actions = createRoot((cleanup) => {
    dispose = cleanup;
    return createDraftActions(options);
  });
  return { actions, options, context };
}

describe('spreadsheet draft actions', () => {
  it('waits for the save acknowledgement before attaching and suppresses double clicks', async () => {
    const { actions, options, context } = fixture();
    let acknowledge = () => {};
    options.saveDocument.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        })
    );
    const opening = actions.ask();
    await vi.waitFor(() => expect(options.saveDocument).toHaveBeenCalledOnce());
    expect(actions.pending()).toBe('ask');
    await actions.ask();
    await actions.share();
    expect(options.createDocument).toHaveBeenCalledOnce();
    expect(options.openChat).not.toHaveBeenCalled();
    acknowledge();
    await opening;
    expect(options.openChat).toHaveBeenCalledWith('document-id', context);
    expect(options.openDocument).toHaveBeenCalledWith('document-id', 'ask');
    expect(actions.pending()).toBeUndefined();
  });

  it('preserves the draft after a lost save acknowledgement and retries the same document', async () => {
    const { actions, options } = fixture();
    options.saveDocument.mockRejectedValueOnce(
      new Error('Lost acknowledgement')
    );
    await actions.ask();
    expect(options.onSaveFailure).toHaveBeenCalledWith('ask');
    expect(options.openChat).not.toHaveBeenCalled();
    expect(options.openDocument).not.toHaveBeenCalled();
    expect(actions.pending()).toBeUndefined();
    options.snapshot.mockReturnValue(new Uint8Array([4, 5]));
    await actions.share();
    expect(options.createDocument).toHaveBeenCalledOnce();
    expect(options.saveDocument).toHaveBeenLastCalledWith(
      'document-id',
      new Uint8Array([4, 5])
    );
    expect(options.openDocument).toHaveBeenCalledWith('document-id', 'share');
  });

  it('keeps the local workbook when chat creation fails and reuses the saved document', async () => {
    const { actions, options } = fixture();
    options.openChat.mockResolvedValueOnce(false);
    await actions.ask();
    expect(options.openDocument).not.toHaveBeenCalled();
    expect(options.onSaveFailure).not.toHaveBeenCalled();
    expect(actions.pending()).toBeUndefined();
    await actions.ask();
    expect(options.createDocument).toHaveBeenCalledOnce();
    expect(options.openDocument).toHaveBeenCalledOnce();
  });

  it('does not navigate after the draft is closed during saving', async () => {
    const { actions, options } = fixture();
    let acknowledge = () => {};
    options.saveDocument.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        })
    );
    const saving = actions.ask();
    await vi.waitFor(() => expect(options.saveDocument).toHaveBeenCalledOnce());
    dispose();
    acknowledge();
    await saving;
    expect(options.openChat).not.toHaveBeenCalled();
    expect(options.openDocument).not.toHaveBeenCalled();
  });
});

it('converts an upload once, waits for durable acknowledgement, and retries the same copy after failure', async () => {
  const { actions, options } = fixture();
  options.saveDocument.mockRejectedValueOnce(new Error('Disconnected'));
  await actions.edit();
  expect(options.openDocument).not.toHaveBeenCalled();
  expect(options.onSaveFailure).toHaveBeenCalledWith('edit');
  let acknowledge = () => {};
  options.saveDocument.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  const saving = actions.edit();
  await vi.waitFor(() => expect(options.saveDocument).toHaveBeenCalledTimes(2));
  await actions.edit();
  expect(options.createDocument).toHaveBeenCalledOnce();
  expect(options.openDocument).not.toHaveBeenCalled();
  acknowledge();
  await saving;
  expect(options.openDocument).toHaveBeenCalledWith('document-id', 'edit');
  expect(options.openChat).not.toHaveBeenCalled();
});
