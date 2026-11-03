import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createFileAttachment } from './file-attachment';

describe('attaching CRM files', () => {
  it('retries a partial create with the same source file', async () => {
    const source = {
      sessionKey: () => 'user:team',
      create: vi.fn().mockResolvedValue('created'),
      attach: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined),
      classify: vi.fn().mockResolvedValue(undefined),
    };
    const editor = createRoot(() =>
      createFileAttachment(source, { type: 'company', id: 'acme' })
    );
    expect(await editor.save({ name: 'Invoice', typeId: 'invoice' })).toBe(
      false
    );
    expect(editor.createdId()).toBe('created');
    expect(source.classify).not.toHaveBeenCalled();
    expect(await editor.save({ name: 'Invoice', typeId: 'invoice' })).toBe(
      true
    );
    expect(source.create).toHaveBeenCalledTimes(1);
    expect(source.attach).toHaveBeenLastCalledWith('created', {
      type: 'company',
      id: 'acme',
    });
    expect(source.classify).toHaveBeenCalledWith('created', 'invoice');
  });

  it('preserves an existing classification unless a new type was selected', async () => {
    const source = {
      sessionKey: () => 'user:team',
      create: vi.fn(),
      attach: vi.fn().mockResolvedValue(undefined),
      classify: vi.fn().mockResolvedValue(undefined),
    };
    const editor = createRoot(() =>
      createFileAttachment(source, { type: 'contact', id: 'contact' })
    );
    expect(
      await editor.save({ name: '', documentId: 'shared', typeId: null })
    ).toBe(true);
    expect(source.create).not.toHaveBeenCalled();
    expect(source.classify).not.toHaveBeenCalled();
    expect(source.attach).toHaveBeenCalledWith('shared', {
      type: 'contact',
      id: 'contact',
    });
  });

  it('does not continue a multi-step write after an account or team change', async () => {
    let session = 'first:team';
    const source = {
      sessionKey: () => session,
      create: vi.fn(async () => {
        session = 'second:team';
        return 'created';
      }),
      attach: vi.fn(),
      classify: vi.fn(),
    };
    const editor = createRoot(() =>
      createFileAttachment(source, { type: 'company', id: 'acme' })
    );
    expect(await editor.save({ name: 'Notes', typeId: 'notes' })).toBe(false);
    expect(editor.createdId()).toBe('created');
    expect(source.attach).not.toHaveBeenCalled();
    expect(source.classify).not.toHaveBeenCalled();
    expect(await editor.save({ name: 'Notes', typeId: 'notes' })).toBe(false);
    expect(source.create).toHaveBeenCalledTimes(1);
  });
});
