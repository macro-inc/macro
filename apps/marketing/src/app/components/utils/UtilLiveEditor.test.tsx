import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveDocEditor } from './UtilLiveEditor';

beforeEach(() => {
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    Object.defineProperty(range, 'getClientRects', { value: () => [] });
    return range;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('The document demo has no backend')))
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('website document editor', () => {
  it('renders editable content locally and reports changes to its surrounding title', () => {
    const onInteract = vi.fn();
    const onTitleChange = vi.fn();
    const onReady = vi.fn();
    const view = render(() => (
      <LiveDocEditor
        active
        fallback={() => <p>Static preview</p>}
        onInteract={onInteract}
        onTitleChange={onTitleChange}
        onReady={onReady}
      />
    ));
    const editor = view.getByRole('textbox', {
      name: 'Live Macro document editor',
    });
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(editor.textContent).toContain('Why Macro Docs?');
    expect(onReady).toHaveBeenCalledOnce();
    const heading = editor.querySelector('h1');
    if (!heading) throw new Error('Missing document title');
    heading.textContent = 'Team launch';
    fireEvent.input(editor);
    fireEvent.input(editor);
    expect(onTitleChange).toHaveBeenLastCalledWith('Team launch');
    expect(onInteract).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains the static fallback when the interactive desktop preview is inactive', () => {
    const [active, setActive] = createSignal(false);
    const onReady = vi.fn();
    const view = render(() => (
      <LiveDocEditor
        active={active()}
        onReady={onReady}
        fallback={() => <p>Static preview</p>}
      />
    ));
    expect(view.getByText('Static preview')).toBeTruthy();
    expect(view.queryByRole('textbox')).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    setActive(true);
    expect(view.getByRole('textbox')).toBeTruthy();
    expect(onReady).toHaveBeenCalledOnce();
  });
});
