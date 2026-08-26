import { describe, expect, it } from 'vitest';
import { applyPreferenceToggle } from '../apply-preference-toggle';

describe('applyPreferenceToggle', () => {
  it('disables a type that was on', () => {
    expect(
      applyPreferenceToggle({ disabled_types: [] }, 'channel_mention', false)
    ).toEqual({ disabled_types: ['channel_mention'] });
  });

  it('enables a type that was off', () => {
    expect(
      applyPreferenceToggle(
        { disabled_types: ['channel_mention', 'new_email'] },
        'channel_mention',
        true
      )
    ).toEqual({ disabled_types: ['new_email'] });
  });

  it('treats a missing cache as every type enabled', () => {
    expect(applyPreferenceToggle(undefined, 'new_email', false)).toEqual({
      disabled_types: ['new_email'],
    });
  });
});
