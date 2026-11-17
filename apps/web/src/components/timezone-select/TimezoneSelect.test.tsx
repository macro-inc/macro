import { Popover } from '@kobalte/core/popover';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimezoneSelect } from './TimezoneSelect';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const OPTIONS = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'America/New York' },
];

describe('TimezoneSelect', () => {
  it('does not open or change a disabled field', async () => {
    const onChange = vi.fn();
    render(() => (
      <TimezoneSelect
        value="UTC"
        options={OPTIONS}
        onChange={onChange}
        disabled
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Timezone' });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    await userEvent.click(trigger);
    expect(screen.queryByPlaceholderText('Search timezones...')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on permission loss and stays closed when enabled again', async () => {
    const [disabled, setDisabled] = createSignal(false);
    const onChange = vi.fn();
    render(() => (
      <TimezoneSelect
        value="UTC"
        options={OPTIONS}
        onChange={onChange}
        disabled={disabled()}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Timezone' }));
    expect(
      await screen.findByPlaceholderText('Search timezones...')
    ).toBeTruthy();
    setDisabled(true);
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Search timezones...')).toBeNull()
    );
    setDisabled(false);
    expect(screen.queryByPlaceholderText('Search timezones...')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an unlisted current zone until a different option is explicitly selected', async () => {
    const onChange = vi.fn();
    render(() => (
      <TimezoneSelect
        value="US/Eastern"
        options={OPTIONS}
        onChange={onChange}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Timezone' });
    expect(trigger.textContent).toContain('US/Eastern');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    const search = await screen.findByPlaceholderText('Search timezones...');
    await userEvent.type(search, 'UTC');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('UTC'));
  });

  it('consumes Escape in the search before closing its parent composer', async () => {
    const closeParent = vi.fn();
    render(() => (
      <Popover open>
        <Popover.Content
          class="portal-scope"
          onEscapeKeyDown={closeParent}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <TimezoneSelect
            value="UTC"
            options={OPTIONS}
            onChange={vi.fn()}
            portalScope="local"
          />
        </Popover.Content>
      </Popover>
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Timezone' }));
    const search = await screen.findByPlaceholderText('Search timezones...');
    await userEvent.click(search);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText('Search timezones...')).toBeNull();
    expect(closeParent).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(closeParent).toHaveBeenCalledOnce();
  });
});
