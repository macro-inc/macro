import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentMcpSetup } from './AgentMcpSetup';

afterEach(cleanup);

it('lists the real MCP command and does not report copy success on failure', async () => {
  const view = render(() => <AgentMcpSetup />);
  expect(
    view.getByText(
      'claude mcp add --transport http macro https://mcp-server.macro.com/mcp'
    )
  ).toBeTruthy();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('Not allowed')) },
  });
  fireEvent.click(view.getByRole('button', { name: 'Copy' }));
  await Promise.resolve();
  expect(view.queryByText('Copied')).toBeNull();
});
