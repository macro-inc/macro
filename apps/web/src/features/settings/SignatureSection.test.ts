import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSignatureState,
  isSignatureDirty,
  isSignatureExpanded,
  persistSignatureDraft,
  setSignatureDraft,
  toggleSignatureExpanded,
} from './SignatureSection';
import { finishSignatureRow, signatureRowAction } from './signature-row-action';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));

const LINK = 'link-1';

afterEach(() => {
  clearSignatureState(LINK);
});

describe('persistSignatureDraft', () => {
  it('sends the draft HTML on the row Save path', () => {
    setSignatureDraft(LINK, '<p>Hello</p>');
    toggleSignatureExpanded(LINK);

    const mutate = vi.fn();
    const action = signatureRowAction(
      isSignatureExpanded(LINK),
      isSignatureDirty(LINK, '')
    );
    expect(action).toBe('save');

    finishSignatureRow({
      action,
      save: () =>
        persistSignatureDraft({
          linkId: LINK,
          mutate,
          onSaved: () => {
            if (isSignatureExpanded(LINK)) toggleSignatureExpanded(LINK);
          },
        }),
      toggle: () => toggleSignatureExpanded(LINK),
    });

    expect(mutate).toHaveBeenCalledWith(
      { linkId: LINK, settings: { signature: '<p>Hello</p>' } },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );

    const callbacks = mutate.mock.calls[0]?.[1] as {
      onSuccess: (data: { settings: { signature?: string | null } }) => void;
    };
    callbacks.onSuccess({ settings: { signature: '<p>Hello</p>' } });
    expect(isSignatureDirty(LINK, '<p>Hello</p>')).toBe(false);
    expect(isSignatureExpanded(LINK)).toBe(false);
  });
});
