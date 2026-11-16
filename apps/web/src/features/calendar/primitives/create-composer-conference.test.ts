import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createComposerConference } from './create-composer-conference';

function runWithConference(
  test: (
    model: ReturnType<typeof createComposerConference>,
    lock: () => void,
    change: ReturnType<typeof vi.fn>
  ) => void
) {
  createRoot((dispose) => {
    const [locked, setLocked] = createSignal(false);
    const onChange = vi.fn();
    const model = createComposerConference({
      provider: () => 'google_meet',
      value: () => 'none',
      macroCallsEnabled: () => false,
      canKeepExisting: () => false,
      disabled: locked,
      onChange,
    });
    try {
      test(model, () => setLocked(true), onChange);
    } finally {
      dispose();
    }
  });
}

describe('composer conference choices', () => {
  it('rejects choices the provider does not offer', () => {
    runWithConference((model, _lock, onChange) => {
      model.choose('microsoft_teams');
      model.choose('macro');
      expect(onChange).not.toHaveBeenCalled();
      model.choose('google_meet');
      expect(onChange).toHaveBeenCalledExactlyOnceWith('google_meet');
    });
  });

  it('checks a permission lock again when a previously open menu selects', () => {
    runWithConference((model, lock, onChange) => {
      lock();
      model.choose('google_meet');
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it('keeps the same options when an unrelated host value changes', () => {
    createRoot((dispose) => {
      const [unrelated, setUnrelated] = createSignal(0);
      const model = createComposerConference({
        provider: () => {
          unrelated();
          return 'google_meet';
        },
        value: () => 'none',
        macroCallsEnabled: () => false,
        canKeepExisting: () => false,
        disabled: () => false,
        onChange: vi.fn(),
      });
      const options = model.choices();
      setUnrelated(1);
      expect(model.choices()).toBe(options);
      dispose();
    });
  });
});
