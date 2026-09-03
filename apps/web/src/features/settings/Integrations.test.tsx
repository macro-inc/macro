/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { AddCustomMcpDialog } from './Integrations';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  startAuth: vi.fn(),
}));

vi.mock('@queries/mcp-servers', () => ({
  useAddMcpServerMutation: () => ({
    mutate: mocks.add,
    isPending: false,
  }),
  useStartMcpAuthMutation: () => ({
    mutate: mocks.startAuth,
    isPending: false,
  }),
}));

describe('AddCustomMcpDialog', () => {
  it('saves the server without starting OAuth', () => {
    const onAdded = vi.fn();
    const onOpenChange = vi.fn();
    mocks.add.mockImplementation((_vars, opts) => opts?.onSuccess?.());

    render(() => (
      <AddCustomMcpDialog
        open
        onOpenChange={onOpenChange}
        onAdded={onAdded}
      />
    ));

    fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Linear' },
    });
    fireEvent.input(screen.getByLabelText('URL'), {
      target: { value: 'https://mcp.linear.app/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(mocks.add).toHaveBeenCalledWith(
      { server_name: 'Linear', url: 'https://mcp.linear.app/mcp' },
      expect.any(Object)
    );
    expect(mocks.startAuth).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
