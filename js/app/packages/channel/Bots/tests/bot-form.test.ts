import { describe, expect, it } from 'vitest';
import { slugBotHandle, validateBotForm } from '../botForm';

describe('bot form', () => {
  it('turns a display name into a valid mention handle', () => {
    expect(slugBotHandle('  Release Updates!  ')).toBe('release-updates');
    expect(slugBotHandle('Build__Bot')).toBe('build__bot');
  });

  it('normalizes valid form values', () => {
    const result = validateBotForm({
      name: '  Release bot  ',
      handle: ' release-bot ',
      description: '  Posts releases  ',
      avatarUrl: '  https://example.com/avatar.png  ',
    });

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Release bot',
        handle: 'release-bot',
        description: 'Posts releases',
        avatarUrl: 'https://example.com/avatar.png',
      },
    });
  });

  it('returns field-specific errors', () => {
    const result = validateBotForm({
      name: '',
      handle: 'Invalid Handle',
      description: '',
      avatarUrl: '',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.name).toBe('Enter a bot name.');
    expect(result.errors.handle).toBe(
      "Use lowercase letters, numbers, '-' or '_' only."
    );
  });
});
