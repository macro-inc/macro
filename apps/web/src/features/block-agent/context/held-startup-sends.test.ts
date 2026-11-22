import {
  forgetUnconfirmedSendsInMemory,
  holdUnconfirmedSend,
  pointHeldSends,
} from '@core/agent-session/unconfirmed-sends';
import { clearComposerStorage } from '@core/auth/clear-composer-storage';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it } from 'vitest';
import { createHeldStartupSends } from './held-startup-sends';

const ME = 'macro|me@macro.com';
const PLACEHOLDER = 'warm-placeholder';
const FALLBACK = 'fresh-fallback';
const send = {
  actionId: 'first-prompt',
  action: { type: 'prompt' as const, prompt: 'Hello' },
};

beforeEach(() => {
  localStorage.clear();
  forgetUnconfirmedSendsInMemory();
});

function mount(userId: string | undefined, unavailable = true) {
  return createRoot((dispose) => {
    const [down, setDown] = createSignal(unavailable);
    const held = createHeldStartupSends({
      blockId: () => PLACEHOLDER,
      // A reload: the tab that started the create, and its memory, are gone.
      heldId: () => undefined,
      userId: () => userId,
      unavailable: down,
    });
    return { held, setDown, dispose };
  });
}

it('shows a lost create held under its fallback id after a reload whose load is refused', () => {
  holdUnconfirmedSend(FALLBACK, ME, send);
  pointHeldSends(PLACEHOLDER, FALLBACK, ME);
  forgetUnconfirmedSendsInMemory();

  // The reload loads the placeholder id, which no session has: a 401.
  const view = mount(ME);
  expect(view.held.held()).toEqual([send]);

  view.held.drop(send.actionId);
  expect(view.held.held()).toEqual([]);
  view.dispose();
});

it('shows nothing to another person, or once the block has a session', () => {
  holdUnconfirmedSend(FALLBACK, ME, send);
  pointHeldSends(PLACEHOLDER, FALLBACK, ME);

  const stranger = mount('macro|someone-else@macro.com');
  expect(stranger.held.held()).toEqual([]);
  stranger.dispose();

  const loaded = mount(ME, false);
  expect(loaded.held.held()).toEqual([]);
  loaded.dispose();
});

it('forgets the pointer and the hold on sign-out', () => {
  holdUnconfirmedSend(FALLBACK, ME, send);
  pointHeldSends(PLACEHOLDER, FALLBACK, ME);
  clearComposerStorage();

  expect(localStorage.length).toBe(0);
  const view = mount(ME);
  expect(view.held.held()).toEqual([]);
  view.dispose();
});
