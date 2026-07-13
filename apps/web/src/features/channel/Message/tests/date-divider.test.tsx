/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateDivider } from '../DateDivider';
import { NewDivider } from '../NewDivider';

afterEach(() => {
  vi.useRealTimers();
});

describe('DateDivider', () => {
  it('renders for the first top-level message', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T12:00:00.000Z'));

    render(() => (
      <DateDivider
        createdAt="2026-02-22T10:00:00.000Z"
        listMeta={{
          index: 0,
          isNewMessage: false,
          isFirstNewMessage: false,
        }}
      />
    ));

    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('does not render when the message is a reply or there is no day boundary', () => {
    const { container } = render(() => (
      <>
        <DateDivider
          createdAt="2026-02-22T10:00:00.000Z"
          isReply
          listMeta={{
            index: 0,
            isNewMessage: false,
            isFirstNewMessage: false,
          }}
        />
        <DateDivider
          createdAt="2026-02-22T10:00:00.000Z"
          listMeta={{
            index: 1,
            isNewMessage: false,
            isFirstNewMessage: false,
            previousTopLevelCreatedAt: '2026-02-22T09:00:00.000Z',
          }}
        />
      </>
    ));

    expect(container.textContent).toBe('');
  });
});

describe('NewDivider', () => {
  it('renders for the first new top-level message and calls dismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(() => (
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

    const button = screen.getByRole('button', { name: 'New' });
    await user.click(button);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
