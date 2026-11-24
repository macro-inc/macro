/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';
import { Menu } from './Menu';
import { Popover } from './Popover';
import { Slider } from './Slider';

afterEach(cleanup);

it('keeps an item with a disabled reason reachable, described, and inert', () => {
  const select = vi.fn();
  render(() => (
    <Dropdown open>
      <Dropdown.Trigger>Add</Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Item
          disabledReason="GPT OSS 120B doesn't support images"
          onSelect={select}
        >
          Add photos
        </Dropdown.Item>
        <Dropdown.Item>Add files</Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  ));
  const item = screen.getByRole('menuitem', { name: /Add photos/ });
  expect(item.getAttribute('aria-disabled')).toBe('true');
  expect(item.hasAttribute('data-disabled')).toBe(true);
  const files = screen.getByRole('menuitem', { name: 'Add files' });
  files.focus();
  fireEvent.keyDown(files, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(item);
  const reason = document.getElementById(
    item.getAttribute('aria-describedby') ?? ''
  );
  expect(reason?.textContent).toBe("GPT OSS 120B doesn't support images");
  fireEvent.keyDown(item, { key: 'Enter' });
  fireEvent.click(item);
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByRole('menu')).toBeTruthy();
});

it('keeps copy items open, waits for completion, and guards pending activations', async () => {
  let finish!: () => void;
  const copy = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  render(() => (
    <Dropdown open>
      <Dropdown.Trigger>Actions</Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.CopyItem onCopy={copy}>Copy link</Dropdown.CopyItem>
      </Dropdown.Content>
    </Dropdown>
  ));
  const item = screen.getByRole('menuitem', { name: 'Copy link' });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
  fireEvent.click(item);
  expect(copy).toHaveBeenCalledOnce();
  expect(item.querySelector('[data-copy-feedback]')).toBeNull();
  finish();
  await Promise.resolve();
  expect(item.querySelector('[data-copy-feedback]')).not.toBeNull();
  expect(item.textContent).toBe('Copy link');
  expect(document.activeElement).toBe(item);
  expect(screen.getByRole('menu')).toBeTruthy();
});

it.each([() => false, () => Promise.reject(new Error('denied'))])(
  'keeps failed copy items open without showing success',
  async (copy) => {
    render(() => (
      <Dropdown open>
        <Dropdown.Trigger>Actions</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.CopyItem onCopy={copy}>Copy link</Dropdown.CopyItem>
        </Dropdown.Content>
      </Dropdown>
    ));
    const item = screen.getByRole('menuitem', { name: 'Copy link' });
    fireEvent.click(item);
    await Promise.resolve();
    expect(item.querySelector('[data-copy-feedback]')).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();
  }
);

it('does not call disabled copy items', () => {
  const copy = vi.fn();
  render(() => (
    <Dropdown open>
      <Dropdown.Trigger>Actions</Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.CopyItem disabled onCopy={copy}>
          Copy link
        </Dropdown.CopyItem>
      </Dropdown.Content>
    </Dropdown>
  ));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
  expect(copy).not.toHaveBeenCalled();
});

it('shares menu surfaces and row styles with form popovers', () => {
  const select = vi.fn();
  render(() => (
    <Popover open>
      <Popover.Trigger variant="ghost" size="xs">
        Models
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content>
          <Popover.Title class="sr-only">Choose a model</Popover.Title>
          <Menu.Group aria-label="Model choices">
            <Menu.Label>Models</Menu.Label>
            <Menu.Item onClick={select}>Available</Menu.Item>
            <Menu.Item disabled onClick={select}>
              Unavailable
            </Menu.Item>
          </Menu.Group>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  ));
  const surface = screen.getByRole('dialog');
  expect(surface.classList.contains('menu-surface')).toBe(true);
  expect(surface.style.boxShadow).toBe('');
  expect(surface.style.border).toBe('');
  const item = screen.getByRole('button', { name: 'Available' });
  expect(item.classList.contains('rounded-lg')).toBe(true);
  expect(item.classList.contains('p-1.5')).toBe(true);
  item.focus();
  expect(item.hasAttribute('data-highlighted')).toBe(true);
  fireEvent.click(item);
  fireEvent.click(screen.getByRole('button', { name: 'Unavailable' }));
  expect(select).toHaveBeenCalledOnce();
});

it('keeps native and managed menu rows and groups visually identical', () => {
  render(() => (
    <>
      <Menu.Group aria-label="Native group">
        <Menu.Label>Native label</Menu.Label>
        <Menu.Item>Native row</Menu.Item>
      </Menu.Group>
      <Dropdown open>
        <Dropdown.Trigger>Open</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group aria-label="Managed group">
            <Dropdown.GroupLabel>Managed label</Dropdown.GroupLabel>
            <Dropdown.Item>Managed row</Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </>
  ));
  expect(screen.getByText('Native row').className).toBe(
    screen.getByText('Managed row').className
  );
  expect(
    screen.getByText('Native label').closest('[role="group"]')?.className
  ).toBe(
    screen.getByText('Managed label').closest('[role="group"]')?.className
  );
  expect(screen.getByText('Native label').className).toBe(
    screen.getByText('Managed label').className
  );
});

it('preserves polymorphic menu items when sharing their styles', () => {
  render(() => (
    <Dropdown open>
      <Dropdown.Trigger>Actions</Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <Dropdown.Item as="a" href="/app/agents" closeOnSelect={false}>
            Agents
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  ));
  const link = screen.getByRole('menuitem', { name: 'Agents' });
  expect(link.tagName).toBe('A');
  expect(link.getAttribute('href')).toBe('/app/agents');
  expect(link.classList.contains('p-1.5')).toBe(true);
});

it('uses neutral slider tokens without changing its value or keyboard behavior', () => {
  const [value, setValue] = createSignal([1]);
  render(() => (
    <Slider
      tone="neutral"
      value={value()}
      onChange={setValue}
      minValue={0}
      maxValue={3}
      step={1}
    >
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb aria-label="Thinking">
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
    </Slider>
  ));
  const slider = screen.getByRole('slider', { name: 'Thinking' });
  const track = slider.closest('.bg-active');
  expect(track).not.toBeNull();
  expect(track?.querySelector('.bg-ink-muted')).not.toBeNull();
  expect(track?.querySelector('.bg-accent')).toBeNull();
  slider.focus();
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(value()).toEqual([2]);
});
