/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';

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
  const animate = vi.fn<Element['animate']>(
    () => ({ cancel: vi.fn() }) as unknown as Animation
  );
  const originalAnimate = Element.prototype.animate;
  Element.prototype.animate = animate as unknown as Element['animate'];
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  );
  try {
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
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 0 });
  } finally {
    Element.prototype.animate = originalAnimate;
    vi.unstubAllGlobals();
  }
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
