import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type ComponentProps, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailRowActions, EmailStarAction } from './EmailRowActions';

vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));

afterEach(cleanup);

function Actions(
  props: ComponentProps<typeof EmailStarAction> &
    ComponentProps<typeof EmailRowActions>
) {
  return (
    <>
      <EmailStarAction {...props} />
      <EmailRowActions {...props} />
    </>
  );
}

describe('email row actions', () => {
  it('runs the clicked action without activating or dragging the row', () => {
    const openThread = vi.fn();
    const startDrag = vi.fn();
    const onStar = vi.fn();
    const onArchive = vi.fn();
    const onCommands = vi.fn();
    render(() => (
      <div
        onClick={openThread}
        onPointerDown={startDrag}
        onMouseDown={startDrag}
      >
        <Actions
          starred={false}
          archived={false}
          canArchive
          pending={false}
          onStar={onStar}
          onArchive={onArchive}
          onCommands={onCommands}
          onFocus={() => {}}
        />
      </div>
    ));

    for (const name of ['Star email', 'Archive email', 'Open command menu']) {
      const button = screen.getByRole('button', { name });
      fireEvent.pointerDown(button);
      fireEvent.mouseDown(button);
      fireEvent.click(button);
    }
    expect(onStar).toHaveBeenCalledOnce();
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onCommands).toHaveBeenCalledOnce();
    expect(openThread).not.toHaveBeenCalled();
    expect(startDrag).not.toHaveBeenCalled();
  });

  it('reflects star/archive changes and disables unavailable or pending writes', () => {
    const [starred, setStarred] = createSignal(false);
    const [archived, setArchived] = createSignal(false);
    const [pending, setPending] = createSignal(false);
    const [canArchive, setCanArchive] = createSignal(true);
    render(() => (
      <Actions
        starred={starred()}
        archived={archived()}
        canArchive={canArchive()}
        pending={pending()}
        onStar={() => setStarred(!starred())}
        onArchive={() => setArchived(!archived())}
        onCommands={() => {}}
        onFocus={() => {}}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Star email' }));
    expect(
      screen
        .getByRole('button', { name: 'Unstar email' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Archive email' }));
    const archive = screen.getByRole('button', { name: 'Unarchive email' });
    setCanArchive(false);
    expect(archive.hasAttribute('disabled')).toBe(true);
    setCanArchive(true);
    setPending(true);
    expect(archive.hasAttribute('disabled')).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Unstar email' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Open command menu' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('isolates button activation keys while preserving list navigation keys', () => {
    const onListKey = vi.fn();
    const onFocus = vi.fn();
    render(() => (
      <div onKeyDown={onListKey}>
        <Actions
          starred={false}
          archived={false}
          canArchive
          pending={false}
          onStar={() => {}}
          onArchive={() => {}}
          onCommands={() => {}}
          onFocus={onFocus}
        />
      </div>
    ));
    const button = screen.getByRole('button', { name: 'Open command menu' });
    fireEvent.focusIn(button);
    expect(onFocus).toHaveBeenCalledOnce();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });
    expect(onListKey).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(onListKey).toHaveBeenCalledOnce();
  });
});
