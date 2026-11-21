import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@queries/mcp-servers', () => ({
  useAddMcpServerMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));

import { AddCustomMcpDialog } from './add-custom-mcp-dialog';

describe('Add MCP Server dialog', () => {
  it('names the host of the URL as it is edited', () => {
    render(() => (
      <AddCustomMcpDialog
        open
        onOpenChange={() => {}}
        initialName="Acme"
        initialUrl="https://mcp.acme.example/mcp"
        title={(url) => `Add ${new URL(url).host}?`}
      />
    ));

    expect(screen.getByText('Add mcp.acme.example?')).toBeTruthy();
    fireEvent.input(screen.getByPlaceholderText('https://example.com/mcp'), {
      target: { value: 'https://other.example/mcp' },
    });
    expect(screen.getByText('Add other.example?')).toBeTruthy();
  });
});
