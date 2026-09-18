/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeText, FoldedExchange } from './FoldedExchange';

vi.mock('@phosphor/copy.svg', () => ({ default: () => <svg /> }));
vi.mock('@phosphor/check.svg', () => ({ default: () => <svg /> }));

afterEach(cleanup);

const section = (view: ReturnType<typeof render>, label: string) =>
  view.container.querySelector<HTMLElement>(
    `[data-exchange-section="${label}"]`
  );

describe('FoldedExchange', () => {
  it('shows the request and a JSON response as labelled, pretty-printed sections', () => {
    const view = render(() => (
      <FoldedExchange
        request={{ documentId: 'doc-1', limit: 5 }}
        response={{ content: { text: 'Q3 plan' }, ok: true, count: null }}
      />
    ));
    const request = section(view, 'request');
    expect(request?.textContent).toContain('Request');
    expect(request?.querySelector('pre')?.textContent).toBe(
      JSON.stringify({ documentId: 'doc-1', limit: 5 }, null, 2)
    );
    const response = section(view, 'response');
    expect(response?.querySelector('pre')?.textContent).toBe(
      JSON.stringify(
        { content: { text: 'Q3 plan' }, ok: true, count: null },
        null,
        2
      )
    );
    expect(section(view, 'error')).toBeNull();
  });

  it('lights JSON by token kind', () => {
    const view = render(() => (
      <FoldedExchange request={{ name: 'x', n: 1, on: true, none: null }} />
    ));
    const pre = section(view, 'request')?.querySelector('pre');
    const classes = (selector: string) =>
      [...(pre?.querySelectorAll(selector) ?? [])].map((el) => el.textContent);
    expect(classes('.text-cyan')).toEqual(['"name"', '"n"', '"on"', '"none"']);
    expect(classes('.text-green')).toEqual(['"x"']);
    expect(classes('.text-orange')).toEqual(['1', 'true', 'null']);
  });

  it('shows a string response as its text, unquoted and unlit', () => {
    const view = render(() => (
      <FoldedExchange response="Launching skill: hexagonal-architecture" />
    ));
    const pre = section(view, 'response')?.querySelector('pre');
    expect(pre?.textContent).toBe('Launching skill: hexagonal-architecture');
    expect(pre?.querySelector('span')).toBeNull();
  });

  it('falls back to reported text when there is no structured response', () => {
    const view = render(() => (
      <FoldedExchange responseText="1 match in src/a.rs" />
    ));
    expect(section(view, 'response')?.querySelector('pre')?.textContent).toBe(
      '1 match in src/a.rs'
    );
    expect(section(view, 'request')).toBeNull();
  });

  it('shows nothing for slots the call did not report', () => {
    const view = render(() => (
      <FoldedExchange request={null} response={null} responseText={null} />
    ));
    expect(view.container.querySelectorAll('section')).toHaveLength(0);
  });

  it('shows an error in its own section, read as a failure', () => {
    const view = render(() => (
      <FoldedExchange request={{}} error="permission denied" />
    ));
    const error = section(view, 'error');
    expect(error?.querySelector('pre')?.textContent).toBe('permission denied');
    expect(
      error?.querySelector('pre')?.classList.contains('text-failure')
    ).toBe(true);
    // A tool that takes nothing still made a request.
    expect(section(view, 'request')?.querySelector('pre')?.textContent).toBe(
      '{}'
    );
  });

  it('copies a section whole', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const view = render(() => (
      <FoldedExchange response={{ answer: 42, nested: { deep: [1, 2] } }} />
    ));
    view.getByRole('button', { name: 'Copy response' }).click();
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify({ answer: 42, nested: { deep: [1, 2] } }, null, 2)
    );
    // The button says so for a moment, then offers to copy again.
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Copied' })).toBeTruthy()
    );
    await waitFor(
      () =>
        expect(
          view.getByRole('button', { name: 'Copy response' })
        ).toBeTruthy(),
      { timeout: 3000 }
    );
  });
});

describe('exchangeText', () => {
  it('pretty-prints JSON and leaves strings alone', () => {
    expect(exchangeText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(exchangeText('plain')).toBe('plain');
    expect(exchangeText([1, 'two'])).toBe('[\n  1,\n  "two"\n]');
  });
});
