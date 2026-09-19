/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { FoldedTerminal } from './FoldedTerminal';

afterEach(cleanup);

/**
 * jsdom lays nothing out, so the scroll geometry a real terminal body would
 * have is pinned by hand: a viewport of 100px over content that grows with
 * the output.
 */
function withGeometry(element: HTMLElement, scrollHeight: number) {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: 100,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
}

function terminal(container: HTMLElement): HTMLElement {
  const pre = container.querySelector('pre');
  if (!pre) throw new Error('the output body renders as a <pre>');
  return pre;
}

describe('FoldedTerminal', () => {
  it('follows the tail while the command streams', () => {
    const [output, setOutput] = createSignal('1\n');
    const view = render(() => <FoldedTerminal output={output()} active />);
    const body = terminal(view.container);
    withGeometry(body, 400);

    setOutput('1\n2\n');
    expect(body.scrollTop).toBe(400);
    expect(body.dataset.following).toBe('true');
  });

  it('stops following once the reader scrolls up, and resumes at the bottom', () => {
    const [output, setOutput] = createSignal('1\n');
    const view = render(() => <FoldedTerminal output={output()} active />);
    const body = terminal(view.container);
    withGeometry(body, 400);

    body.scrollTop = 10;
    fireEvent.scroll(body);
    expect(body.dataset.following).toBe('false');
    setOutput('1\n2\n');
    expect(body.scrollTop).toBe(10);

    body.scrollTop = 300;
    fireEvent.scroll(body);
    expect(body.dataset.following).toBe('true');
    withGeometry(body, 500);
    setOutput('1\n2\n3\n');
    expect(body.scrollTop).toBe(500);
  });

  it('leaves a finished command where the reader left it', () => {
    const [output, setOutput] = createSignal('1\n');
    const view = render(() => (
      <FoldedTerminal output={output()} exitCode={0} active={false} />
    ));
    const body = terminal(view.container);
    withGeometry(body, 400);

    setOutput('1\n2\n');
    expect(body.scrollTop).toBe(0);
  });

  it('shows a caret only while running, and the exit code only on failure', () => {
    const running = render(() => <FoldedTerminal output="…" active />);
    expect(running.container.querySelector('.animate-pulse')).not.toBeNull();
    expect(running.queryByText(/Exit code/)).toBeNull();
    cleanup();

    const failed = render(() => (
      <FoldedTerminal output="boom" exitCode={2} active={false} />
    ));
    expect(failed.container.querySelector('.animate-pulse')).toBeNull();
    expect(failed.getByText('Exit code 2')).toBeTruthy();
    cleanup();

    const clean = render(() => (
      <FoldedTerminal output="ok" exitCode={0} active={false} />
    ));
    expect(clean.queryByText(/Exit code/)).toBeNull();
  });
});
