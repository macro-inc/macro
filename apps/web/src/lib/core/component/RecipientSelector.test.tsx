import { recipientEntityMapper, type WithCustomUserInput } from '@core/user';
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

  it('keeps the recipients and the text when Enter is pressed on an invalid address', async () => {
    const user = userEvent.setup();
    const { input, emails } = renderSelector();
    fireEvent.input(input, { target: { value: 'qa@example.com,' } });
    await user.type(input, 'notanemail{Enter}');
    expect(emails()).toEqual(['qa@example.com']);
    expect(input.value).toBe('notanemail');
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

describe('RecipientSelector scrolling', () => {
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  const recipient = (email: string): WithCustomUserInput => ({
    kind: 'custom',
    id: email,
    data: { id: email, email, invalid: false },
  });

  it('keeps the page where it is when the owner rebuilds the same selection', async () => {
    // Owners often derive the selection from wider state, so an unrelated
    // edit hands back a new array with the same recipients.
    const [revision, setRevision] = createSignal(0);
    const [emails, setEmails] = createSignal(['a@example.com']);
    const selection = () => {
      revision();
      return emails().map(recipient);
    };
    render(() => (
      <RecipientSelector
        options={() => []}
        selectedOptions={selection()}
        setSelectedOptions={(next) =>
          setEmails(
            next.flatMap((option) =>
              option.kind === 'custom' ? [option.data.email] : []
            )
          )
        }
      />
    ));
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();

    setRevision(1);
    await nextFrame();
    expect(scrollIntoView).not.toHaveBeenCalled();

    setEmails(['a@example.com', 'b@example.com']);
    await nextFrame();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});

describe('RecipientSelector when full', () => {
  it('takes no typing and opens no suggestions, but Backspace still removes the chip', async () => {
    const user = userEvent.setup();
    const [selected, setSelected] = createSignal<WithCustomUserInput[]>([
      {
        kind: 'custom',
        id: 'qa@example.com',
        data: { id: 'qa@example.com', email: 'qa@example.com', invalid: false },
      },
    ]);
    render(() => (
      <RecipientSelector
        options={() => [
          recipientEntityMapper('user')({
            id: 'macro|ana@example.com',
            email: 'ana@example.com',
            name: 'Ana',
          }),
        ]}
        selectedOptions={selected()}
        setSelectedOptions={setSelected}
        full={selected().length > 0}
      />
    ));
    const input = screen.getByRole<HTMLInputElement>('combobox');

    await user.click(input);
    await user.keyboard('ana');
    expect(input.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.keyboard('{Backspace}');
    expect(selected()).toEqual([]);

    await user.keyboard('ana');
    expect(input.value).toBe('ana');
    expect(await screen.findByRole('listbox')).toBeTruthy();
  });
});
