/**
 * @vitest-environment jsdom
 */

import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateDivider } from '../DateDivider';
import { NewDivider } from '../NewDivider';

function renderComponent(component: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(component, container);

  return {
    container,
    cleanup: () => {
      dispose();
      container.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('DateDivider', () => {
  it('renders for the first top-level message', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T12:00:00.000Z'));

    const { container, cleanup } = renderComponent(() => (
      <DateDivider
        createdAt="2026-02-22T10:00:00.000Z"
        listMeta={{
          index: 0,
          isNewMessage: false,
          isFirstNewMessage: false,
        }}
      />
    ));

    expect(container.textContent).toContain('Today');
    cleanup();
  });

  it('does not render for replies', () => {
    const { container, cleanup } = renderComponent(() => (
      <DateDivider
        createdAt="2026-02-22T10:00:00.000Z"
        isReply
        listMeta={{
          index: 0,
          isNewMessage: false,
          isFirstNewMessage: false,
        }}
      />
    ));

    expect(container.textContent).toBe('');
    cleanup();
  });

  it('does not render when there is no day boundary', () => {
    const { container, cleanup } = renderComponent(() => (
      <DateDivider
        createdAt="2026-02-22T10:00:00.000Z"
        listMeta={{
          index: 1,
          isNewMessage: false,
          isFirstNewMessage: false,
          previousTopLevelCreatedAt: '2026-02-22T09:00:00.000Z',
        }}
      />
    ));

    expect(container.textContent).toBe('');
    cleanup();
  });
});

describe('NewDivider', () => {
  it('renders for the first new top-level message and calls dismiss', () => {
    const onDismiss = vi.fn();
    const { container, cleanup } = renderComponent(() => (
      <NewDivider
        listMeta={{
          index: 2,
          isNewMessage: true,
          isFirstNewMessage: true,
          previousTopLevelCreatedAt: '2026-02-21T09:00:00.000Z',
        }}
        onDismiss={onDismiss}
      />
    ));

    expect(container.textContent).toContain('New');
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    button?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
    cleanup();
  });

  it('does not render for replies', () => {
    const { container, cleanup } = renderComponent(() => (
      <NewDivider
        isReply
        listMeta={{
          index: 2,
          isNewMessage: true,
          isFirstNewMessage: true,
          previousTopLevelCreatedAt: '2026-02-21T09:00:00.000Z',
        }}
      />
    ));

    expect(container.textContent).toBe('');
    cleanup();
  });
});
