import { describe, expect, it, vi } from 'vitest';
import {
  finishSignatureRow,
  signatureRowAction,
  signatureRowLabel,
} from './signature-row-action';

describe('signatureRowAction', () => {
  it('is Edit when the editor is closed', () => {
    expect(signatureRowAction(false, false)).toBe('edit');
    expect(signatureRowAction(false, true)).toBe('edit');
    expect(signatureRowLabel('edit')).toBe('Edit');
  });

  it('is Done when the editor is open and clean', () => {
    expect(signatureRowAction(true, false)).toBe('done');
    expect(signatureRowLabel('done')).toBe('Done');
  });

  it('is Save when the editor is open and dirty', () => {
    expect(signatureRowAction(true, true)).toBe('save');
    expect(signatureRowLabel('save')).toBe('Save');
  });
});

describe('finishSignatureRow', () => {
  it('persists instead of collapsing when the row action is Save', () => {
    const save = vi.fn();
    const toggle = vi.fn();
    finishSignatureRow({ action: 'save', save, toggle });
    expect(save).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
  });

  it('toggles for Edit and Done', () => {
    const save = vi.fn();
    const toggle = vi.fn();
    finishSignatureRow({ action: 'edit', save, toggle });
    finishSignatureRow({ action: 'done', save, toggle });
    expect(save).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});
