import type { WithCustomUserInput } from '@core/user';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipientSelector } from './RecipientSelector';

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'me@example.com',
  useUserId: () => () => 'macro|me@example.com',
}));
vi.mock('@core/user/dmActivity', () => ({
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element }) => <>{props.trigger}</>,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSelector() {
  const [selected, setSelected] = createSignal<WithCustomUserInput[]>([]);
  render(() => (
    <RecipientSelector
      options={() => []}
      selectedOptions={selected()}
      setSelectedOptions={setSelected}
    />
  ));
  const emails = () =>
    selected().map((option) =>
      option.kind === 'custom' ? option.data.email : option.kind
    );
  return {
    input: screen.getByRole<HTMLInputElement>('combobox'),
    emails,
  };
}

describe('RecipientSelector typed addresses', () => {
  it('turns an address ended by a comma into a recipient and clears the input', () => {
    const { input, emails } = renderSelector();
    fireEvent.input(input, { target: { value: 'qa@example.com,' } });
    expect(emails()).toEqual(['qa@example.com']);
    expect(screen.getByText('qa@example.com')).toBeTruthy();
    expect(input.value).toBe('');
  });

  it('adds every address in a pasted list once', () => {
    const { input, emails } = renderSelector();
    fireEvent.input(input, {
      target: { value: 'a@example.com; b@example.com, A@example.com,' },
    });
    expect(emails()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('clears an address that is already a recipient', () => {
    const { input, emails } = renderSelector();
    fireEvent.input(input, { target: { value: 'ana@example.org;' } });
    fireEvent.input(input, { target: { value: 'Ana@example.org;' } });
    expect(emails()).toEqual(['ana@example.org']);
    expect(input.value).toBe('');
  });

  it('keeps an address typed straight after picking a suggestion', async () => {
    const user = userEvent.setup();
    const { input, emails } = renderSelector();
    await user.type(input, 'bob@example.com');
    await screen.findByRole('listbox');
    await user.keyboard('{Enter}carol@example.com,');
    await waitFor(() =>
      expect(emails()).toEqual(['bob@example.com', 'carol@example.com'])
    );
    expect(input.value).toBe('');
  });

  it('leaves text until a separator ends a complete address', () => {
    const { input, emails } = renderSelector();
    fireEvent.input(input, {
      target: { value: 'a@example.com, b@example.org' },
    });
    fireEvent.input(input, { target: { value: 'a@example.com, b@exa,' } });
    expect(emails()).toEqual([]);
  });
});
