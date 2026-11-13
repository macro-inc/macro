import { render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { fakeBrowser, VIEWER } from '../tests/local-store';
import { ACME_DRAFT } from '../tests/packets';
import { PerSignIn, type SignIn } from './per-sign-in';

/** A workspace reduced to what matters here: one account's packet titles. */
function renderWorkspace(first: SignIn) {
  const browser = fakeBrowser();
  const [signIn, setSignIn] = createSignal<SignIn | undefined>(first);
  const stores = new Map<string, ReturnType<typeof open>>();
  const open = (userId: string) => browser.open(userId).context(VIEWER);

  render(() => (
    <PerSignIn signIn={signIn()}>
      {(userId) => {
        const contracts = open(userId);
        stores.set(userId, contracts);
        return (
          <ul aria-label={`Packets of ${userId}`}>
            <For each={contracts.packets()}>
              {(packet) => <li>{packet.title}</li>}
            </For>
          </ul>
        );
      }}
    </PerSignIn>
  ));
  return { setSignIn, store: (userId: string) => stores.get(userId) };
}

describe('PerSignIn', () => {
  it('closes one account’s contracts while the next login is confirmed', async () => {
    const { setSignIn, store } = renderWorkspace({ userId: 'ada', session: 1 });
    const ada = store('ada');
    await ada?.createDraft({ ...ACME_DRAFT, title: 'Ada’s packet' });
    expect(await screen.findByText('Ada’s packet')).toBeTruthy();

    // A new login has started; who it is has not been confirmed yet.
    setSignIn(undefined);
    expect(screen.queryByText('Ada’s packet')).toBeNull();
    const late = await ada?.createDraft({ ...ACME_DRAFT, title: 'Too late' });
    expect(late?.isErr()).toBe(true);

    setSignIn({ userId: 'grace', session: 2 });
    expect(screen.getByRole('list', { name: 'Packets of grace' })).toBeTruthy();
    expect(screen.queryByText('Ada’s packet')).toBeNull();
    expect(screen.queryByText('Too late')).toBeNull();
    expect(store('grace')?.packets()).toEqual([]);
  });

  it('gives the same account a new workspace when it signs in again', () => {
    const { setSignIn, store } = renderWorkspace({ userId: 'ada', session: 1 });
    const before = store('ada');

    setSignIn({ userId: 'ada', session: 2 });

    expect(store('ada')).not.toBe(before);
  });

  it('keeps the workspace when the sign-in is reported again unchanged', () => {
    const { setSignIn, store } = renderWorkspace({ userId: 'ada', session: 1 });
    const before = store('ada');

    setSignIn({ userId: 'ada', session: 1 });

    expect(store('ada')).toBe(before);
  });
});
