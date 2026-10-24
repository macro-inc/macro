import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipientSelector } from './RecipientSelector';

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'me@example.com',
  useUserId: () => () => 'macro|me@example.com',
}));
vi.mock('@core/user/dmActivity', () => ({
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSelector() {
  const setSelectedOptions = vi.fn();
  render(() => (
    <RecipientSelector
      options={() => []}
      selectedOptions={[]}
      setSelectedOptions={setSelectedOptions}
    />
  ));
  return { input: screen.getByRole('combobox'), setSelectedOptions };
}

describe('RecipientSelector typed addresses', () => {
  it('adds an address once a comma ends it', () => {
    const { input, setSelectedOptions } = renderSelector();
    fireEvent.input(input, { target: { value: 'qa-nobody@example.com,' } });
    expect(setSelectedOptions).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'custom',
        data: expect.objectContaining({ email: 'qa-nobody@example.com' }),
      }),
    ]);
  });

  it('adds every address in a pasted list', () => {
    const { input, setSelectedOptions } = renderSelector();
    fireEvent.input(input, {
      target: { value: 'a@example.com; b@example.com,' },
    });
    expect(
      setSelectedOptions.mock.lastCall?.[0].map(
        (option: { data: { email: string } }) => option.data.email
      )
    ).toEqual(['a@example.com', 'b@example.com']);
  });

  it('leaves text until a separator ends a complete address', () => {
    const { input, setSelectedOptions } = renderSelector();
    fireEvent.input(input, {
      target: { value: 'a@example.com, b@example.co' },
    });
    fireEvent.input(input, { target: { value: 'a@example.com, b@exa,' } });
    expect(setSelectedOptions).not.toHaveBeenCalled();
  });
});
