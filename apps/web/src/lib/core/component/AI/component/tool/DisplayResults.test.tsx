import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@app/features/dynamic-ui/DashboardToolView.lazy', () => ({
  DashboardToolView: (props: { view: { title?: string } }) => (
    <section aria-label="Dashboard">{props.view.title}</section>
  ),
}));

import { displayResultsHandler } from './DisplayResults';
import { ToolErrorContext } from './ToolRenderer';

afterEach(cleanup);

const view = { title: 'Your week', widgets: [] };

function displayResults(error?: string) {
  return render(() => (
    <ToolErrorContext.Provider value={() => error}>
      <displayResultsHandler.render
        tool={{ id: 'call-1', name: 'DisplayResults', data: { view } }}
        response={undefined}
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete
        renderContext={{
          isStreaming: false,
          grouped: false,
          followedBy: () => false,
        }}
      />
    </ToolErrorContext.Provider>
  ));
}

it('renders the view the call composed', () => {
  const rendered = displayResults();
  expect(rendered.getByRole('region', { name: 'Dashboard' }).textContent).toBe(
    'Your week'
  );
});

it('shows a call the tool turned back as failed, not as a view', () => {
  const rendered = displayResults(
    'The view was not shown: it does not match the DisplayResults schema.'
  );
  expect(rendered.queryByRole('region', { name: 'Dashboard' })).toBeNull();
  expect(rendered.getByText('Display results')).toBeTruthy();
  expect(rendered.getByText('Failed')).toBeTruthy();
});
