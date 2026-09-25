import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  pending: true,
  bot: { name: 'Research agent', avatar_url: 'https://example.com/avatar.png' },
  enabled: undefined as (() => boolean) | undefined,
  botId: undefined as (() => string) | undefined,
}));

vi.mock('@queries/bots/bots', () => ({
  useBotQuery: (id: () => string, enabled: () => boolean) => {
    fixture.botId = id;
    fixture.enabled = enabled;
    return {
      get isPending() {
        return fixture.pending;
      },
      get data() {
        if (fixture.pending)
          throw new Error('Pending bot data must not be read');
        return fixture.bot;
      },
    };
  },
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Alice Example',
  tryMacroId: (id: string) => (id.startsWith('macro|') ? id : undefined),
  getDisplayNameParts: () => ({
    firstName: 'Alice',
    fullName: 'Alice Example',
  }),
}));

import { usePropertyUserDisplay } from './usePropertyUserDisplay';

beforeEach(() => {
  fixture.pending = true;
});

describe('property user identity', () => {
  it('preserves human names without fetching a bot', () => {
    createRoot((dispose) => {
      const display = usePropertyUserDisplay(() => 'macro|alice@example.com');
      expect(display.name()).toBe('Alice Example');
      expect(display.shortName()).toBe('Alice');
      expect(fixture.enabled?.()).toBe(false);
      dispose();
    });
  });

  it('resolves bot names and photos without suspending task properties', () => {
    createRoot((dispose) => {
      const [id, setId] = createSignal('bot|research-id');
      const display = usePropertyUserDisplay(id);
      expect(fixture.botId?.()).toBe('research-id');
      expect(fixture.enabled?.()).toBe(true);
      expect(display.name()).toBe('Agent');
      expect(display.photoUrl()).toBeUndefined();
      fixture.pending = false;
      expect(display.name()).toBe('Research agent');
      expect(display.shortName()).toBe('Research agent');
      expect(display.photoUrl()).toBe('https://example.com/avatar.png');
      setId('macro|alice@example.com');
      expect(fixture.enabled?.()).toBe(false);
      expect(display.name()).toBe('Alice Example');
      dispose();
    });
  });
});
