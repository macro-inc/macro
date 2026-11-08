// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CallTranscript } from './CallTranscript';

vi.mock('@channel/Message', () => ({
  Message: {
    Root: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    SenderIcon: () => null,
    SenderName: () => <span>Speaker</span>,
    Content: () => null,
    Attachments: () => null,
  },
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: JSX.Element }) => props.children,
  })
);
vi.mock('@queries/messages/message-sender', () => ({
  senderFromStorageId: () => ({ type: 'user', user_id: 'speaker' }),
}));
vi.mock('@ui', () => ({
  Button: (props: { children: JSX.Element; onClick: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
  Avatar: Object.assign(
    (props: { children: JSX.Element }) => <span>{props.children}</span>,
    { Fallback: (props: { children: JSX.Element }) => props.children }
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('seeks from a transcript row and resumes following after manual scrolling', () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  let rowTop = 200;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const seek = vi.fn();
  const scroll = vi.fn();
  const viewport = document.createElement('div');
  viewport.scrollTo = scroll;
  const [manualScrollGeneration, setManualScrollGeneration] = createSignal(0);
  const [seekGeneration, setSeekGeneration] = createSignal(0);
  const syncTarget = document.createElement('div');
  document.body.append(syncTarget);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const top = this.hasAttribute('data-call-transcript-row') ? rowTop : 0;
      return {
        top,
        bottom: top + 100,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: top,
        toJSON() {},
      };
    }
  );
  const [active, setActive] = createSignal<number | null>(null);
  render(() => (
    <CallTranscript
      transcript={[
        {
          transcriptId: 'line',
          speakerId: 'speaker',
          content: 'A recorded sentence',
          sequenceNum: 1,
          startedAt: '2026-01-01T00:00:10Z',
        },
      ]}
      timelineStartMs={Date.parse('2026-01-01T00:00:00Z')}
      activeSequenceNum={active()}
      onSeekToSeconds={seek}
      hideHeader
      scrollElement={viewport}
      manualScrollGeneration={manualScrollGeneration()}
      videoSeekGeneration={seekGeneration()}
      syncTarget={syncTarget}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: /A recorded sentence/ }));
  expect(seek).toHaveBeenCalledWith(10);
  fireEvent.wheel(viewport);
  setActive(1);
  const sync = screen.getByRole('button', { name: 'Sync to video' });
  expect(syncTarget.contains(sync)).toBe(true);
  fireEvent.click(sync);
  expect(scroll).toHaveBeenCalled();

  scroll.mockClear();
  fireEvent.pointerDown(viewport, { pointerType: 'mouse' });
  setActive(null);
  setActive(1);
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sync to video' }));
  expect(scroll).toHaveBeenCalled();

  scroll.mockClear();
  setManualScrollGeneration(1);
  fireEvent.scroll(viewport);
  setActive(null);
  setActive(1);
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sync to video' }));
  expect(scroll).toHaveBeenCalled();

  scroll.mockClear();
  setSeekGeneration(1);
  fireEvent.scroll(viewport);
  expect(screen.queryByRole('button', { name: 'Sync to video' })).toBeNull();
  setActive(null);
  setActive(1);
  expect(scroll).toHaveBeenCalled();
  scroll.mockClear();
  fireEvent.keyDown(viewport, { key: 'PageDown' });
  setActive(null);
  setActive(1);
  expect(scroll).not.toHaveBeenCalled();
  rowTop = 0;
  setSeekGeneration(2);
  fireEvent.wheel(viewport);
  rowTop = 200;
  fireEvent.scroll(viewport);
  expect(screen.getByRole('button', { name: 'Sync to video' })).toBeTruthy();
  syncTarget.remove();
});
