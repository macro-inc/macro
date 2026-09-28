import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';

// jsdom has no ResizeObserver; a directory's collapse animation measures with one.
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({ width: 0, height: 0 }),
}));

type Item = { path: string; label: string };

const ITEMS: Item[] = [
  { path: 'src/a.ts', label: 'Alpha' },
  { path: 'src/b.ts', label: 'Beta' },
  { path: 'README.md', label: 'Readme' },
];

function mount() {
  const [selected, setSelected] = createSignal<string>();
  render(() => (
    <FileTree.Root
      aria-label="Files"
      items={ITEMS}
      path={(item) => item.path}
      selected={selected()}
      onSelect={(item) => setSelected(item.path)}
    >
      {(file) => (
        <>
          <FileTree.Name />
          <span>{file.item.label}</span>
        </>
      )}
    </FileTree.Root>
  ));
  return { selected };
}

describe('FileTree', () => {
  it("renders the host's row content under compressed directories", () => {
    mount();
    expect(screen.getByRole('group', { name: 'Files' })).toBeTruthy();
    expect(screen.getByTitle('src/a.ts').textContent).toBe('a.tsAlpha');
    expect(screen.getByRole('button', { name: 'Collapse src' })).toBeTruthy();
  });

  it('selects a file and marks it current', () => {
    const { selected } = mount();
    fireEvent.click(screen.getByTitle('src/b.ts'));
    expect(selected()).toBe('src/b.ts');
    expect(screen.getByTitle('src/b.ts').getAttribute('aria-current')).toBe(
      'true'
    );
    expect(
      screen.getByTitle('src/a.ts').getAttribute('aria-current')
    ).toBeNull();
  });

  it('closes and opens a directory from its row', async () => {
    mount();
    fireEvent.click(screen.getByTitle('src'));
    await waitFor(() => expect(screen.queryByTitle('src/a.ts')).toBeNull());
    expect(screen.getByRole('button', { name: 'Expand src' })).toBeTruthy();
    fireEvent.click(screen.getByTitle('src'));
    await waitFor(() => expect(screen.getByTitle('src/a.ts')).toBeTruthy());
  });

  it('moves between rows and closes a directory with the arrow keys', async () => {
    mount();
    const file = screen.getByTitle('src/a.ts');
    file.focus();
    fireEvent.keyDown(file, { key: 'ArrowUp' });
    const directory = screen.getByTitle('src');
    expect(document.activeElement).toBe(directory);

    fireEvent.keyDown(directory, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.queryByTitle('src/a.ts')).toBeNull());
    fireEvent.keyDown(directory, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTitle('README.md'));
  });
});
