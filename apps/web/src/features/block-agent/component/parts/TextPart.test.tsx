/**
 * @vitest-environment jsdom
 *
 * A settled message's markdown must not re-render when only `inFlight`
 * flips: sending a prompt briefly marks the previous agent message live, and
 * each re-render rebuilds its DOM, reloading every image in it.
 */

import { render } from '@solidjs/testing-library';
import { createEffect, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
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

describe('TextPart', () => {
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
