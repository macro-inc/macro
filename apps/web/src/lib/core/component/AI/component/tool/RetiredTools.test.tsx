/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { RenderTool } from './handler';

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));

afterEach(cleanup);

const renderContext = {
  renderContext: { isStreaming: false, followedBy: () => false },
};

// ReadThread has no live tool: Rust registers it only as a retired schema.
it('renders a saved call of a tool registered only as a retired schema', () => {
  const view = render(() => (
    <RenderTool
      tool_id="call-1"
      name="ReadThread"
      json={{ contentType: 'channel', ids: ['a', 'b'] }}
      part_index={0}
      chat_id="chat-1"
      message_id="message-1"
      isComplete={true}
      renderContext={renderContext}
    />
  ));
  expect(view.getByText('2 channels')).toBeTruthy();
});

it('shows a saved call of a tool with no schema by its name', () => {
  const view = render(() => (
    <RenderTool
      tool_id="call-2"
      name="SomeDeletedTool"
      json={{ anything: true }}
      error="It broke"
      part_index={0}
      chat_id="chat-1"
      message_id="message-1"
      isComplete={true}
      renderContext={renderContext}
    />
  ));
  expect(view.getByText('SomeDeletedTool')).toBeTruthy();
  expect(view.getByText('Failed')).toBeTruthy();
});

it('still hides a known tool whose saved call no longer parses', () => {
  const view = render(() => (
    <RenderTool
      tool_id="call-3"
      name="ReadThread"
      json={{ contentType: 'not-a-type' }}
      part_index={0}
      chat_id="chat-1"
      message_id="message-1"
      isComplete={true}
      renderContext={renderContext}
    />
  ));
  expect(view.container.textContent).toBe('');
});
