import { render } from '@solidjs/testing-library';
import { createContext, useContext } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { composeEnvironment } from '../../email-compose/tests/capabilities';
import { useEmailRendering } from '../../email-message/context/email-rendering-context';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { dependencies, message, thread } from '../tests/fixtures';
import { EmailThreadSurface } from './email-thread-surface';

// Replace only the large UI subtree; exercise real providers, state, and host frame ordering.
vi.mock('./email-thread', () => ({
  EmailThreadView: (props: { header?: unknown }) => <>{props.header}</>,
}));
const HostContext = createContext<string>();
describe('thread composition ownership', () => {
  it('constructs content beneath the host frame and feature providers', () => {
    const deps = dependencies({
      thread: () => thread([message('one')]),
      isLoading: () => false,
      isFetching: () => false,
      isFetchingOlder: () => false,
      hasMore: () => false,
      async fetchOlder() {},
      async refresh() {},
    });
    const Probe = () => {
      const state = useEmailThreadState();
      useEmailRendering();
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
        environment={{
          dependencies: deps,
          compose: composeEnvironment(),
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
  it('fails clearly when a required capability provider is omitted', () => {
    expect(() => useEmailRendering()).toThrow('EmailRenderingProvider');
    expect(() => useEmailThreadState()).toThrow();
  });
});
