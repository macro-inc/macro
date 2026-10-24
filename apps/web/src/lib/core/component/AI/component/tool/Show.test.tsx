import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@app/features/dynamic-ui/DashboardToolView.lazy', () => ({
  DashboardToolView: (props: { view: { title?: string } }) => (
    <section aria-label="Dashboard">{props.view.title}</section>
  ),
}));

import { displayResultsHandler, showHandler } from './Show';
import { ToolErrorContext } from './ToolRenderer';

afterEach(cleanup);

const view = { title: 'Your week', widgets: [] };

const context = {
  response: undefined,
  chat_id: 'chat-1',
  message_id: 'message-1',
  part_index: 0,
  isComplete: true,
  renderContext: {
    isStreaming: false,
    grouped: false,
    followedBy: () => false,
  },
};

function show(error?: string) {
  return render(() => (
    <ToolErrorContext.Provider value={() => error}>
      <showHandler.render
        tool={{ id: 'call-1', name: 'Show', data: { view } }}
        {...context}
      />
    </ToolErrorContext.Provider>
  ));
}

it('renders the view the call composed', () => {
  const rendered = show();
  expect(rendered.getByRole('region', { name: 'Dashboard' }).textContent).toBe(
    'Your week'
  );
});

it('renders the view of a chat saved before the rename', () => {
  const rendered = render(() => (
    <displayResultsHandler.render
      tool={{ id: 'call-1', name: 'DisplayResults', data: { view } }}
      {...context}
    />
  ));
  expect(rendered.getByRole('region', { name: 'Dashboard' }).textContent).toBe(
    'Your week'
  );
});

it('shows nothing for a call the tool turned back', () => {
  const rendered = show(
    'The view was not shown: it does not match the Show schema.'
  );
  expect(rendered.container.innerHTML).toBe('');
});
