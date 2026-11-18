import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PickerSheet } from './PickerSheet';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
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

function renderPicker() {
  const [open, setOpen] = createSignal(false);
  render(() => (
    <>
      <input aria-label="Title" />
      <button onClick={() => setOpen(true)}>Guests</button>
      <PickerSheet.Root open={open()} onCancel={() => setOpen(false)}>
        <PickerSheet.Header title="Guests" onDone={() => setOpen(false)} />
        <PickerSheet.Body>
          <input type="text" aria-label="Search" />
        </PickerSheet.Body>
      </PickerSheet.Root>
    </>
  ));
  return { title: screen.getByLabelText<HTMLInputElement>('Title') };
}

it.each(['Cancel', 'Done'])(
  'hands focus back to the field the opener left it in on %s',
  (action) => {
    const { title } = renderPicker();
    title.value = 'Call the venue';
    title.focus();
    title.setSelectionRange(4, 4);

    // The opener doesn't take focus, so the title still has it.
    fireEvent.click(screen.getByText('Guests'));
    screen.getByText('Cancel').focus();
    fireEvent.click(screen.getByText(action));

    expect(document.activeElement).toBe(title);
    expect(title.selectionStart).toBe(4);
  }
);

it('leaves focus alone when no field had it', () => {
  renderPicker();
  const opener = screen.getByText('Guests');

  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByText('Cancel'));

  expect(document.activeElement).not.toBe(screen.getByLabelText('Title'));
});
