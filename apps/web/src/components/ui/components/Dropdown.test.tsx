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
