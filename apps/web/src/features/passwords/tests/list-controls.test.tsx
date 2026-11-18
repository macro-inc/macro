import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PasswordTypeControls } from '../components/list-controls';
import type { PasswordGroupBy, PasswordKind } from '../core/types';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function mount(initial: PasswordKind[] = []) {
  const [kinds, setKinds] = createSignal<PasswordKind[]>(initial);
  const [groupBy, setGroupBy] = createSignal<PasswordGroupBy>('none');
  render(() => (
    <PasswordTypeControls
      kinds={kinds()}
      groupBy={groupBy()}
      onKindChange={(kind, selected) =>
        setKinds((current) =>
          selected
            ? [...current, kind]
            : current.filter((each) => each !== kind)
        )
      }
      onClearKinds={() => setKinds([])}
      onGroupByChange={setGroupBy}
    />
  ));
  return { kinds, groupBy, user: userEvent.setup() };
}

it('filters by type from the shared filter menu and shows how many types apply', async () => {
  const { kinds, user } = mount();
  await user.click(screen.getByRole('button', { name: 'Filter items' }));
  const type = await screen.findByRole('menuitem', { name: 'Type' });
  await waitFor(() => expect(document.activeElement).toBe(type));
  fireEvent.keyDown(type, { key: 'ArrowRight' });
  for (const name of [
    'Login',
    'Card',
    'Secure note',
    'Identity',
    'API credential',
    'Verification code',
  ])
    expect(await screen.findByRole('menuitemcheckbox', { name })).toBeTruthy();

  fireEvent(
    screen.getByRole('menuitemcheckbox', { name: 'Card' }),
    new MouseEvent('pointerup', { button: 0, bubbles: true })
  );
  expect(kinds()).toEqual(['card']);
  expect(screen.getByLabelText('Filter items').textContent).toBe('1');
});

it('clears the type filter from the menu', async () => {
  const { kinds, user } = mount(['card', 'note']);
  await user.click(screen.getByRole('button', { name: 'Filter items' }));
  await user.click(
    await screen.findByRole('menuitem', { name: 'Clear filters' })
  );
  expect(kinds()).toEqual([]);
});

it('groups by type from the shared group menu', async () => {
  const { groupBy, user } = mount();
  await user.click(screen.getByRole('button', { name: 'Group by' }));
  expect(
    (await screen.findAllByRole('menuitemradio')).map(
      (item) => item.textContent
    )
  ).toEqual(['None', 'Type']);
  await user.click(screen.getByRole('menuitemradio', { name: 'Type' }));
  expect(groupBy()).toBe('kind');
});
