import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRecentRepositories,
  resetRecentRepositoriesForTests,
} from './recent-repositories';

const USER = 'macro|recents@example.com';
const MACRO = 'https://github.com/macro-inc/macro';
const INFRA = 'https://github.com/macro-inc/infra';

afterEach(() => {
  localStorage.clear();
  resetRecentRepositoriesForTests();
  vi.useRealTimers();
});

describe('createRecentRepositories', () => {
  it('shares one newest-first list per user and ignores an older observe', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const first = createRecentRepositories(USER);
    first.remember(MACRO);
    vi.setSystemTime(2_000);
    first.remember(INFRA);
    first.observe(MACRO, 500);
    const second = createRecentRepositories(USER);
    expect(second.urls()).toEqual([INFRA, MACRO]);
  });

  it('reads and writes the current user when the id is an accessor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let current = USER;
    const recents = createRecentRepositories(() => current);
    recents.remember(MACRO);
    current = 'macro|other@example.com';
    expect(recents.urls()).toEqual([]);
    recents.remember(INFRA);
    expect(recents.urls()).toEqual([INFRA]);
    current = USER;
    expect(recents.urls()).toEqual([MACRO]);
  });

  it('restores the earlier url list as newest first', () => {
    localStorage.setItem(
      `agents-view-repositories-v1:${encodeURIComponent(USER)}`,
      JSON.stringify([INFRA, MACRO])
    );
    expect(createRecentRepositories(USER).urls()).toEqual([INFRA, MACRO]);
  });
});
