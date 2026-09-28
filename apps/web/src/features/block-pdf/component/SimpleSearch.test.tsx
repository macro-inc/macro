import type { FindBarController } from '@core/component/createFindBarController';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfViewerProvider, usePdfViewer } from '../context/pdf-viewer-context';
import { SimpleSearch } from './SimpleSearch';

const search = vi.hoisted(() => ({
  close: vi.fn(),
  jumpToResult: vi.fn(),
  start: vi.fn(),
}));

vi.mock('../signal/search', () => ({
  useJumpToResult: () => search.jumpToResult,
  useSearchClose: () => search.close,
  useSearchResults: () => () => null,
  useSearchStart: () => search.start,
}));

vi.mock('@core/component/FindBar', () => ({
  FindBar: (props: { controller: FindBarController }) => (
    <>
      <input
        placeholder="Find"
        value={props.controller.query()}
        onInput={(event) =>
          props.controller.setQuery(event.currentTarget.value)
        }
      />
      <button
        aria-label="Close find bar"
        onClick={() => props.controller.close()}
      />
    </>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function SearchOwner(props: { documentId: string }) {
  const pdfViewer = usePdfViewer();
  return (
    <div
      data-testid="search-root"
      data-document-id={props.documentId}
      ref={pdfViewer.setRootElement}
    >
      <SimpleSearch />
    </div>
  );
}

describe('SimpleSearch', () => {
  it('keeps search state local to its keyed viewer owner', async () => {
    const [documentId, setDocumentId] = createSignal('document-1');

    render(() => (
      <Show when={documentId()} keyed>
        {(id) => (
          <PdfViewerProvider>
            <SearchOwner documentId={id} />
          </PdfViewerProvider>
        )}
      </Show>
    ));

    const firstRoot = screen.getByTestId('search-root');
    fireEvent.keyDown(firstRoot, {
      key: 'f',
      ctrlKey: true,
      metaKey: true,
    });
    const input = await screen.findByPlaceholderText('Find');
    fireEvent.input(input, { target: { value: 'retained query' } });

    fireEvent.click(screen.getByRole('button', { name: 'Close find bar' }));
    expect(screen.queryByPlaceholderText('Find')).toBeNull();

    fireEvent.keyDown(screen.getByTestId('search-root'), {
      key: 'f',
      ctrlKey: true,
      metaKey: true,
    });
    expect(
      ((await screen.findByPlaceholderText('Find')) as HTMLInputElement).value
    ).toBe('retained query');

    setDocumentId('document-2');
    await waitFor(() =>
      expect(screen.getByTestId('search-root')).not.toBe(firstRoot)
    );
    fireEvent.keyDown(screen.getByTestId('search-root'), {
      key: 'f',
      ctrlKey: true,
      metaKey: true,
    });
    expect(
      ((await screen.findByPlaceholderText('Find')) as HTMLInputElement).value
    ).toBe('');
  });
});
