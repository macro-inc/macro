/**
 * @vitest-environment jsdom
 */

import type { MessageData } from '@core/messages/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Content } from '../Content';
import { CollapseLongContentProvider, MessageProvider } from '../context';

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => <p>{props.markdown}</p>,
  })
);
vi.mock('../MentionedImages', () => ({ MentionedImages: () => null }));

const message = {
  id: 'comment',
  content: 'A very long comment',
  sender_id: 'macro|ada@example.com',
  created_at: '2026-10-21T00:00:00.000Z',
  updated_at: '2026-10-21T00:00:00.000Z',
  attachments: [],
  reactions: [],
} as unknown as MessageData;

function setBodyHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(
    height
  );
}

function renderContent(collapse: boolean) {
  return render(() => (
    <CollapseLongContentProvider value={collapse}>
      <MessageProvider value={() => message}>
        <Content />
      </MessageProvider>
    </CollapseLongContentProvider>
  ));
}

describe('long message content', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('folds behind Show more and expands and collapses again', () => {
    setBodyHeight(800);
    const view = renderContent(true);
    const preview = () => view.container.querySelector('[data-collapsed]');

    expect(preview()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(preview()).toBeNull();
    expect(screen.getByText('A very long comment')).toBeTruthy();

    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(less);
    expect(preview()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
  });

  it('reveals a hidden link when focus moves into it', () => {
    setBodyHeight(800);
    const view = renderContent(true);
    const preview = () => view.container.querySelector('[data-collapsed]');
    const text = screen.getByText('A very long comment');
    vi.spyOn(preview()!, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
    } as DOMRect);

    // Focus above the cut leaves the preview alone.
    vi.spyOn(text, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
    } as DOMRect);
    fireEvent.focusIn(text);
    expect(preview()).not.toBeNull();

    // Focus under the cut expands so the focused link is visible.
    vi.spyOn(text, 'getBoundingClientRect').mockReturnValue({
      bottom: 400,
    } as DOMRect);
    fireEvent.focusIn(text);
    expect(preview()).toBeNull();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
  });

  it('leaves a short comment whole', () => {
    setBodyHeight(120);
    const view = renderContent(true);

    expect(view.container.querySelector('[data-collapsed]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never folds where the host does not ask for it', () => {
    setBodyHeight(800);
    const view = renderContent(false);

    expect(view.container.querySelector('[data-collapsed]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
