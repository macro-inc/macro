import { render } from '@solidjs/testing-library';
import { createContext, useContext } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import { useEmailRenderingContext } from '../../email-message/context/email-rendering-context';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { EmailThreadSurface } from './email-thread-surface';

// This verifies provider/frame ordering only. The full view still imports app
// services through shared UI, including UserIcon's direct-message mutation.
vi.mock('./email-thread', () => ({
  EmailThreadView: (props: { header?: unknown }) => <>{props.header}</>,
}));
const HostContext = createContext<string>();
describe('thread composition ownership', () => {
  it('constructs content beneath the host frame and feature providers', () => {
    const threadContext = createThreadContext({
      thread: () => thread([message('one')]),
    });
    const Probe = () => {
      const state = useEmailThreadState();
      useEmailRenderingContext();
      return (
        <p>
          {useContext(HostContext)}:{state.messages.list()[0].db_id}
        </p>
      );
    };
    const view = render(() => (
      <EmailThreadSurface
        title="Review"
        threadId={() => 'thread'}
        context={{
          thread: threadContext,
          compose: createComposeContext(),
          rendering: {},
        }}
        emailRendering={{
          theme: () => ({
            inkL: 0,
            inkC: 0,
            inkH: 0,
            panelL: 1,
            accentL: 0,
            accentC: 0,
            accentH: 0,
          }),
          resolveImages: async () => {},
        }}
        frame={(content) => (
          <HostContext.Provider value="host">{content()}</HostContext.Provider>
        )}
        header={<Probe />}
      />
    ));
    try {
      expect(view.getByText('host:one')).toBeTruthy();
    } finally {
      view.unmount();
    }
  });
});
