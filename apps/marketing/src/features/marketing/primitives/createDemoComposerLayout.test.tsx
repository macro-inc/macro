import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ChannelComposer,
  type ChannelComposerHandle,
} from '../components/email/frozen/ChannelComposer';

let compactHeight = 24;
beforeEach(() => {
  compactHeight = 24;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600);
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: Element) {
      return this.closest('[data-composer-compact]')?.getAttribute(
        'data-composer-compact'
      ) === 'true'
        ? compactHeight
        : 24;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('uses measured wrapping rather than a character limit and does not repeatedly collapse the live input', async () => {
  let composer: ChannelComposerHandle | undefined;
  const view = render(() => (
    <ChannelComposer
      onSend={() => {}}
      onReady={(handle) => {
        composer = handle;
      }}
    />
  ));
  await Promise.resolve();
  const input = view.getByRole('textbox');
  const layout = input.closest('[data-input-layout]')!;
  composer!.setText('a'.repeat(80));
  await Promise.resolve();
  expect(layout.getAttribute('data-composer-compact')).toBe('true');
  expect(input.style.height).toBe('24px');
  compactHeight = 48;
  composer!.setText('a'.repeat(30));
  await Promise.resolve();
  expect(layout.getAttribute('data-composer-compact')).toBe('false');
  expect(input.style.height).toBe('24px');
  expect(
    view.container.querySelector('[aria-hidden="true"][data-input-layout]')
  ).toBeNull();
});

it('keeps the user selection and mention nodes intact when measuring an edited rich composer', async () => {
  const view = render(() => <ChannelComposer richMentions onSend={() => {}} />);
  const input = view.getByRole('textbox');
  const mention = document.createElement('span');
  mention.dataset.demoMention = 'teo';
  mention.contentEditable = 'false';
  mention.textContent = '@Teo';
  const text = document.createTextNode(' please review');
  input.append(mention, text);
  const range = document.createRange();
  range.setStart(text, 7);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.input(input);
  await Promise.resolve();
  expect(input.querySelector('[data-demo-mention]')).toBe(mention);
  expect(window.getSelection()!.anchorNode).toBe(text);
  expect(window.getSelection()!.anchorOffset).toBe(7);
});
