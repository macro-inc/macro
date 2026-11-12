/** @vitest-environment jsdom */
import { ContextMenuContent, CopyMenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalAnimate)
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

it('keeps the context menu and keyboard focus during a pending copy', async () => {
  let finish!: () => void;
  const copy = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  render(() => (
    <ContextMenu>
      <ContextMenu.Trigger as="button">Actions</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent>
          <CopyMenuItem text="Copy link" onCopy={copy} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  ));
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Actions' }));
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
  'does not show context-menu success for a failed copy',
  async (copy) => {
    render(() => (
      <ContextMenu>
        <ContextMenu.Trigger as="button">Actions</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent>
            <CopyMenuItem text="Copy link" onCopy={copy} />
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    ));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Actions' }));
    const item = screen.getByRole('menuitem', { name: 'Copy link' });
    fireEvent.click(item);
    await Promise.resolve();
    expect(item.querySelector('[data-copy-feedback]')).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();
  }
);

it('does not activate a disabled context-menu copy item', () => {
  const copy = vi.fn();
  render(() => (
    <ContextMenu>
      <ContextMenu.Trigger as="button">Actions</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent>
          <CopyMenuItem text="Copy link" disabled onCopy={copy} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  ));
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
  expect(copy).not.toHaveBeenCalled();
});
