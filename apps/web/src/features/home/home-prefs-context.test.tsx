import { cleanup, render, screen } from '@solidjs/testing-library';
import { batch, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type HomePreferences,
  HomePreferencesProvider,
  useHomePreferences,
} from './home-prefs';

function mountPreferences(initialUserId = 'user-1') {
  const [userId, setUserId] = createSignal<string | undefined>(initialUserId);
  const consumers: HomePreferences[] = [];
  function Consumer() {
    const preferences = useHomePreferences();
    consumers.push(preferences);
    return (
      <span>
        {preferences.isDismissed('getting-started-link') ? 'hidden' : 'visible'}
      </span>
    );
  }
  const view = render(() => (
    <HomePreferencesProvider userId={userId}>
      <Consumer />
      <Consumer />
    </HomePreferencesProvider>
  ));
  return { ...view, consumers, setUserId };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('shared Home preferences', () => {
  it('updates all mounted consumers immediately', () => {
    const { consumers } = mountPreferences();
    const [first, second] = consumers;
    expect(first).toBe(second);
    expect(screen.getAllByText('visible')).toHaveLength(2);

    second.dismiss('getting-started-link');
    expect(screen.getAllByText('hidden')).toHaveLength(2);
    expect(
      JSON.parse(localStorage.getItem('macro:home:dismissed:user-1') ?? '[]')
    ).toEqual(['getting-started-link']);

    first.restore('getting-started-link');
    expect(screen.getAllByText('visible')).toHaveLength(2);
    expect(localStorage.getItem('macro:home:dismissed:user-1')).toBe('[]');
  });

  it('keeps dismissals isolated when users change, including same-turn writes', () => {
    localStorage.setItem('macro:home:dismissed:user-2', '[]');
    const { consumers, setUserId } = mountPreferences();
    const [preferences] = consumers;
    preferences.dismiss('getting-started-link');
    expect(screen.getAllByText('hidden')).toHaveLength(2);

    batch(() => {
      setUserId('user-2');
      preferences.dismiss('getting-started-link');
    });
    expect(screen.getAllByText('hidden')).toHaveLength(2);
    expect(
      JSON.parse(localStorage.getItem('macro:home:dismissed:user-2') ?? '[]')
    ).toEqual(['getting-started-link']);

    setUserId(undefined);
    expect(preferences.isDismissed('getting-started-link')).toBe(false);
    preferences.dismiss('getting-started-link');
    setUserId('user-1');
    expect(screen.getAllByText('hidden')).toHaveLength(2);
    expect(localStorage.getItem('macro:home:dismissed:user-1')).toBe(
      '["getting-started-link"]'
    );
  });

  it('restores persisted dismissals when the provider remounts', () => {
    const first = mountPreferences();
    first.consumers[0].dismiss('getting-started-link');
    first.unmount();

    mountPreferences();
    expect(screen.getAllByText('hidden')).toHaveLength(2);
  });
});
