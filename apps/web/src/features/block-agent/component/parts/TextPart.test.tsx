/**
 * @vitest-environment jsdom
 *
 * A settled message's markdown must not re-render when only `inFlight`
 * flips: sending a prompt briefly marks the previous agent message live, and
 * each re-render rebuilds its DOM, reloading every image in it.
 */

import { cleanup, render } from '@solidjs/testing-library';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextPart } from './TextPart';

const parses = vi.hoisted((): string[] => []);

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => {
      createEffect(() => {
        parses.push(props.markdown);
      });
      return null;
    },
  })
);
vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  channelTheme: {},
}));

afterEach(cleanup);

describe('TextPart', () => {
  it('keeps an unfinished agent chip hidden when the stream settles', () => {
    parses.length = 0;
    const [inFlight, setInFlight] = createSignal(true);
    render(() => (
      <TextPart
        text={'See <m-document-mention>{"documentId":"unfinished'}
        hideIncompleteXml
        inFlight={inFlight()}
      />
    ));
    setInFlight(false);
    expect(parses).toEqual(['See ']);
  });

  it('preserves complete chips and surrounding text in settled replies', () => {
    parses.length = 0;
    const complete =
      '<m-document-mention>{"documentId":"abc","documentName":"Notes","blockName":"md","blockParams":{}}</m-document-mention>';
    render(() => (
      <TextPart
        text={`Before ${complete} after. Next <m-user-mention>{"userId":`}
        hideIncompleteXml
      />
    ));
    expect(parses).toEqual([`Before ${complete} after. Next `]);
  });
  it('hands mounted markdown DOM to its observer and cleans up when unmounted', () => {
    const stop = vi.fn();
    const observe = vi.fn((element: HTMLElement) => {
      expect(element.isConnected).toBe(true);
      expect(element.classList.contains('chat-markdown-container')).toBe(true);
      return stop;
    });
    const view = render(() => (
      <TextPart text="Hello" observeRender={observe} />
    ));
    expect(observe).toHaveBeenCalledOnce();
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not re-render unchanged markdown when inFlight flips', () => {
    parses.length = 0;
    const [inFlight, setInFlight] = createSignal(false);
    render(() => <TextPart text="![shot](/a.png)" inFlight={inFlight()} />);

    setInFlight(true);
    setInFlight(false);

    expect(parses).toEqual(['![shot](/a.png)']);
  });

  it('re-renders when the in-flight text hides an unclosed tag', () => {
    parses.length = 0;
    const [inFlight, setInFlight] = createSignal(false);
    render(() => <TextPart text="hi <m-document" inFlight={inFlight()} />);

    setInFlight(true);

    expect(parses).toEqual(['hi <m-document', 'hi ']);
  });
});
