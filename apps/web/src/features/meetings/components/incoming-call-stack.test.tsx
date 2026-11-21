import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { IncomingCallNotification } from './incoming-call-notification';
import { IncomingCallStack } from './incoming-call-stack';

// jsdom lays nothing out; every card measures the same, as in the app.
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 480, height: 82 }),
}));

afterEach(cleanup);

const CALLERS: Record<string, string> = {
  newest: 'Ada Lovelace',
  middle: 'Grace Hopper',
  oldest: 'Alan Turing',
};

function renderStack(keys: string[]) {
  const onJoin = vi.fn();
  const [expanded, setExpanded] = createSignal(false);
  render(() => (
    <IncomingCallStack
      keys={keys}
      expanded={expanded()}
      onExpand={() => setExpanded(true)}
      onCollapse={() => setExpanded(false)}
    >
      {(key, concealed) => (
        <IncomingCallNotification
          avatar={null}
          callerName={CALLERS[key]}
          detail="Calling you"
          remainingMs={20_000}
          ringDurationMs={30_000}
          concealed={concealed()}
          onJoin={() => onJoin(key)}
          onDecline={vi.fn()}
        />
      )}
    </IncomingCallStack>
  ));
  return { onJoin };
}

const joinButtons = () => screen.queryAllByRole('button', { name: /^Join/ });

it('shows only the newest call while stacked, and answers that call', async () => {
  const { onJoin } = renderStack(['newest', 'middle', 'oldest']);

  expect(
    joinButtons().map((button) => button.getAttribute('aria-label'))
  ).toEqual(['Join call from Ada Lovelace']);
  await userEvent.click(joinButtons()[0]);
  expect(onJoin).toHaveBeenCalledExactlyOnceWith('newest');
  // Answering the newest call doesn't open the stack.
  expect(joinButtons()).toHaveLength(1);
});

it('fans every call out when opened, and folds them back with Show less', async () => {
  const { onJoin } = renderStack(['newest', 'middle', 'oldest']);

  await userEvent.click(
    screen.getByRole('button', { name: 'Show all 3 incoming calls' })
  );
  expect(screen.getByText('3 incoming calls')).toBeTruthy();
  expect(joinButtons()).toHaveLength(3);

  await userEvent.click(
    screen.getByRole('button', { name: 'Join call from Alan Turing' })
  );
  expect(onJoin).toHaveBeenCalledExactlyOnceWith('oldest');

  await userEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(joinButtons()).toHaveLength(1);
});

it('opens from a click on the newest call itself', async () => {
  renderStack(['newest', 'middle']);

  await userEvent.click(screen.getByRole('heading', { name: 'Ada Lovelace' }));
  expect(joinButtons()).toHaveLength(2);
});

it('has nothing to open for a single call', () => {
  renderStack(['newest']);

  expect(screen.queryByRole('button', { name: /incoming call/ })).toBeNull();
  expect(joinButtons()).toHaveLength(1);
});
