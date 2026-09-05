import { render } from '@solidjs/testing-library';
import { createSignal, onCleanup } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { composeServices } from '../../email-compose/tests/services';
import { createEmailThreadState } from '../primitives/email-thread-state';
import { dependencies, message, thread } from '../tests/fixtures';
import { EmailInput } from './email-input';
import { EmailProvider } from './email-thread-context';
import { ThreadEnvironmentProvider } from './thread-environment';

vi.mock('@ui', () => ({
  Layer: (props: { children: unknown }) => props.children,
}));

const lifecycle = vi.hoisted(() => ({
  mounted: [] as string[],
  disposed: [] as string[],
}));
vi.mock('../../email-compose/views/reply-input', () => ({
  ReplyInputView: (props: {
    replyingTo: () => { db_id: string };
    onEngaged: () => void;
  }) => {
    const id = props.replyingTo().db_id;
    lifecycle.mounted.push(id);
    onCleanup(() => lifecycle.disposed.push(id));
    return <button onClick={props.onEngaged}>{id}</button>;
  },
}));

it('preserves an engaged composer through a same-message update but resets it for a different reply target', () => {
  const first = message('first');
  const second = message('second');
  const deps = dependencies({
    thread: () => thread([first, second]),
    isLoading: () => false,
    isFetching: () => false,
    isFetchingOlder: () => false,
    hasMore: () => false,
    fetchOlder() {},
    refresh() {},
  });
  const [target, setTarget] = createSignal(first);
  const view = render(() => {
    const state = createEmailThreadState(deps);
    return (
      <ThreadEnvironmentProvider
        value={{
          dependencies: deps,
          compose: composeServices(),
          rendering: {},
        }}
      >
        <EmailProvider value={state}>
          <EmailInput replyingTo={target} />
        </EmailProvider>
      </ThreadEnvironmentProvider>
    );
  });
  try {
    view.getByText('first').click();
    setTarget({ ...first, updated_at: '2026-09-05T00:00:00Z' });
    expect(lifecycle.mounted).toEqual(['first']);
    setTarget(second);
    expect(lifecycle.mounted).toEqual(['first', 'second']);
    expect(lifecycle.disposed).toEqual(['first']);
  } finally {
    view.unmount();
  }
});
