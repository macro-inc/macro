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
  it('updates all mounted consumers immediately and preserves other dismissals', () => {
    const { consumers } = mountPreferences();
    const [home, homeChatStart] = consumers;
    expect(home).toBe(homeChatStart);
    expect(screen.getAllByText('visible')).toHaveLength(2);

    home.dismiss('setup');
    homeChatStart.dismiss('getting-started-link');
    expect(screen.getAllByText('hidden')).toHaveLength(2);
    expect(homeChatStart.isDismissed('setup')).toBe(true);
    expect(
      JSON.parse(localStorage.getItem('macro:home:dismissed:user-1') ?? '[]')
    ).toEqual(['setup', 'getting-started-link']);

    home.restore('getting-started-link');
    expect(screen.getAllByText('visible')).toHaveLength(2);
    expect(homeChatStart.isDismissed('setup')).toBe(true);
  });

  it('keeps dismissals isolated when users change, including same-turn writes', () => {
    localStorage.setItem('macro:home:dismissed:user-2', '["setup"]');
    const { consumers, setUserId } = mountPreferences();
    const [preferences] = consumers;
    preferences.dismiss('getting-started-link');

    batch(() => {
      setUserId('user-2');
      preferences.dismiss('examples');
    });
    expect(screen.getAllByText('visible')).toHaveLength(2);
    expect(preferences.isDismissed('setup')).toBe(true);
    expect(
      JSON.parse(localStorage.getItem('macro:home:dismissed:user-2') ?? '[]')
    ).toEqual(['setup', 'examples']);

    setUserId(undefined);
    expect(preferences.isDismissed('setup')).toBe(false);
    preferences.dismiss('examples');
    setUserId('user-1');
    expect(screen.getAllByText('hidden')).toHaveLength(2);
    expect(preferences.isDismissed('setup')).toBe(false);
    expect(preferences.isDismissed('examples')).toBe(false);
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
